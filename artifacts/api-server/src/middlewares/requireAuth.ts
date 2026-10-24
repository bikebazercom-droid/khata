import { Request, Response, NextFunction } from "express";
import { eq, isNull, isNotNull, and, inArray, lt, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  db,
  appUsersTable,
  userLoginEventsTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  userBusinessesTable,
  workerInvitesTable,
  workerPartyAssignmentsTable,
  preapprovedLoginsTable,
  type AppUser,
} from "@workspace/db";
import { clientIp } from "./ipBlock";
import { deviceDescription, recordFailedLoginAttempt } from "../lib/authTelemetry";
import { hashDeletedAccountIdentity } from "../lib/deletedAccountIdentity";

// Fixed UUID for the seed business that owns all pre-auth legacy data.
export const SEED_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

export class PreapprovalRequiredError extends Error {
  constructor(public readonly kind: "phone" | "email", public readonly identifier: string) {
    super("Identity is not on the pre-approved login list");
    this.name = "PreapprovalRequiredError";
  }
}

async function isPreapproved(kind: "phone" | "email", identifier: string): Promise<boolean> {
  const [entry] = await db.select({ id: preapprovedLoginsTable.id })
    .from(preapprovedLoginsTable)
    .where(and(eq(preapprovedLoginsTable.kind, kind), eq(preapprovedLoginsTable.identifier, identifier)))
    .limit(1);
  return !!entry;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
  status: "active" | "suspended";
  authMethod: "firebase" | "phone" | "dev";
  verifiedEmail?: string;
  phone?: string;
}

// ─── Startup migration ───────────────────────────────────────────────────────

export async function ensureDefaultBusiness(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Do not issue an insert for the reserved row when it already exists.
      // The targeted conflict clause still makes concurrent startup attempts safe.
      const [seedBusiness] = await tx
        .select({ id: businessesTable.id })
        .from(businessesTable)
        .where(eq(businessesTable.id, SEED_BUSINESS_ID))
        .limit(1);

      if (!seedBusiness) {
        await tx
          .insert(businessesTable)
          .values({ id: SEED_BUSINESS_ID, name: "আমার খাতা" })
          .onConflictDoNothing({ target: businessesTable.id });
      }

      const [confirmedSeedBusiness] = await tx
        .select({ id: businessesTable.id })
        .from(businessesTable)
        .where(eq(businessesTable.id, SEED_BUSINESS_ID))
        .limit(1);
      if (!confirmedSeedBusiness) {
        throw new Error("Default business row is unavailable after initialization");
      }

      await tx
        .update(partiesTable)
        .set({ businessId: SEED_BUSINESS_ID })
        .where(isNull(partiesTable.businessId));

      await tx
        .update(businessSettingsTable)
        .set({ businessId: SEED_BUSINESS_ID })
        .where(isNull(businessSettingsTable.businessId));

      // Read only the fields needed for membership backfill.
      const existingUsers = await tx
        .select({
          id: appUsersTable.id,
          businessId: appUsersTable.businessId,
          workerAccessDeletedAt: appUsersTable.workerAccessDeletedAt,
        })
        .from(appUsersTable);
      for (const user of existingUsers) {
        if (user.workerAccessDeletedAt) continue;
        await tx
          .insert(userBusinessesTable)
          .values({ userId: user.id, businessId: user.businessId })
          .onConflictDoNothing();
      }
    });
  } catch (err) {
    console.error("[startup] ensureDefaultBusiness failed:", err);
  }
}

// ─── JIT user provisioning ───────────────────────────────────────────────────

async function linkUserBusiness(userId: string, businessId: string) {
  await db
    .insert(userBusinessesTable)
    .values({ userId, businessId })
    .onConflictDoNothing();
}

async function createBusinessForNameSetup(): Promise<string> {
  const [business] = await db
    .insert(businessesTable)
    .values({ name: "" })
    .returning({ id: businessesTable.id });
  await db.insert(businessSettingsTable)
    .values({ businessId: business!.id, storeName: "" })
    .onConflictDoNothing();
  return business!.id;
}

async function requireSeedBusinessNameSetup(): Promise<void> {
  await db.update(businessesTable)
    .set({ name: "" })
    .where(eq(businessesTable.id, SEED_BUSINESS_ID));
  await db.insert(businessSettingsTable)
    .values({ businessId: SEED_BUSINESS_ID, storeName: "" })
    .onConflictDoUpdate({
      target: businessSettingsTable.businessId,
      set: { storeName: "" },
    });
}

async function claimWorkerInvite(identity: { email?: string; phone?: string; firebaseUid?: string }, existing?: AppUser) {
  return db.transaction(async (tx) => {
    const identityCondition = identity.email
      ? eq(workerInvitesTable.email, identity.email)
      : eq(workerInvitesTable.phone, identity.phone!);
    const [candidate] = await tx.select().from(workerInvitesTable)
      .where(and(identityCondition, eq(workerInvitesTable.status, "pending"))).limit(1);
    if (!candidate) return null;
    // Access mutations and claims lock business before invite/user, consistently.
    await tx.select({ id: businessesTable.id }).from(businessesTable)
      .where(eq(businessesTable.id, candidate.businessId)).for("update");
    const [invite] = await tx.select().from(workerInvitesTable)
      .where(and(identityCondition, eq(workerInvitesTable.status, "pending")))
      .for("update").limit(1);
    if (!invite) return null;
    if (existing && (existing.businessId !== invite.businessId || existing.role !== "staff")) return null;
    const [staff] = existing ? await tx.update(appUsersTable).set({
      workerAccessDeletedAt: null, status: "active", adjustmentPartyIds: [],
      ...(identity.firebaseUid ? { firebaseUid: identity.firebaseUid } : {}),
    }).where(and(eq(appUsersTable.id, existing.id), eq(appUsersTable.status, "suspended"),
      isNotNull(appUsersTable.workerAccessDeletedAt)))
      .returning() : await tx.insert(appUsersTable).values({
      firebaseUid: identity.firebaseUid,
      verifiedEmail: identity.email,
      phone: identity.phone,
      businessId: invite.businessId,
      role: "staff",
    }).returning();
    if (!staff) return null;
    await tx.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, staff.id));
    await tx.insert(userBusinessesTable)
      .values({ userId: staff!.id, businessId: invite.businessId }).onConflictDoNothing();
    const eligiblePartyIds = invite.partyIds.length
      ? await tx.select({ id: partiesTable.id }).from(partiesTable).where(and(
        eq(partiesTable.businessId, invite.businessId),
        inArray(partiesTable.id, invite.partyIds),
      ))
      : [];
    if (eligiblePartyIds.length) {
      await tx.insert(workerPartyAssignmentsTable).values(eligiblePartyIds.map(({ id }) => ({
        userId: staff!.id, partyId: id,
      }))).onConflictDoNothing();
    }
    const eligibleTargets = invite.adjustmentPartyIds.length
      ? await tx.select({ id: partiesTable.id }).from(partiesTable).where(and(
        eq(partiesTable.businessId, invite.businessId), inArray(partiesTable.id, invite.adjustmentPartyIds),
      )) : [];
    const [updatedStaff] = await tx.update(appUsersTable).set({
      adjustmentPartyIds: eligibleTargets.map((p) => p.id),
    }).where(eq(appUsersTable.id, staff.id)).returning();
    const [claimedInvite] = await tx.update(workerInvitesTable).set({
      status: "claimed",
      claimedAt: new Date(),
      claimedUserId: staff!.id,
    }).where(and(
      eq(workerInvitesTable.id, invite.id),
      eq(workerInvitesTable.status, "pending"),
    )).returning({ id: workerInvitesTable.id });
    if (!claimedInvite) throw new Error("Worker invitation is no longer pending");
    return updatedStaff!;
  });
}

export async function getOrCreateFirebaseUser(
  firebaseUid: string,
  verifiedEmail: string,
  displayName?: string,
): Promise<AppUser> {
  const email = verifiedEmail.trim().toLowerCase();
  const [byUid] = await db.select().from(appUsersTable)
    .where(eq(appUsersTable.firebaseUid, firebaseUid)).limit(1);
  if (byUid) return byUid;

  const deletedUid = hashDeletedAccountIdentity("firebase", firebaseUid);
  const [deletedAccount] = await db.select({ id: appUsersTable.id }).from(appUsersTable)
    .where(and(
      eq(appUsersTable.firebaseUid, deletedUid),
      isNotNull(appUsersTable.workerAccessDeletedAt),
    )).limit(1);
  if (deletedAccount) throw new Error("This account was deleted and cannot be restored by sign-in.");

  const deletedEmail = hashDeletedAccountIdentity("email", email);
  const [deletedEmailAccount] = await db.select({ id: appUsersTable.id }).from(appUsersTable)
    .where(and(
      eq(appUsersTable.verifiedEmail, deletedEmail),
      eq(appUsersTable.role, "owner"),
      isNotNull(appUsersTable.workerAccessDeletedAt),
    )).limit(1);
  if (deletedEmailAccount) throw new Error("This account was deleted and cannot be restored by sign-in.");

  const emailMatches = await db.select().from(appUsersTable)
    .where(sql`lower(${appUsersTable.verifiedEmail}) = ${email}`).limit(2);
  if (emailMatches.length > 1) {
    throw new Error("Verified email matches multiple accounts; administrator review is required");
  }
  const existing = emailMatches[0];
  if (existing) {
    if (existing.workerAccessDeletedAt) {
      return (await claimWorkerInvite({ email, firebaseUid }, existing)) ?? existing;
    }
    if (existing.status !== "active") return existing;
    if (existing.firebaseUid && existing.firebaseUid !== firebaseUid) {
      throw new Error("This account is already linked to another Google identity");
    }
    const [linked] = await db.update(appUsersTable)
      .set({ firebaseUid })
      .where(eq(appUsersTable.id, existing.id))
      .returning();
    await linkUserBusiness(existing.id, existing.businessId);
    return linked!;
  }

  const invitedStaff = await claimWorkerInvite({ email, firebaseUid });
  if (invitedStaff) return invitedStaff;
  if (!await isPreapproved("email", email)) {
    throw new PreapprovalRequiredError("email", email);
  }
  const [seedOwner] = await db.select().from(appUsersTable).where(and(
    eq(appUsersTable.businessId, SEED_BUSINESS_ID),
    eq(appUsersTable.role, "owner"),
    isNull(appUsersTable.workerAccessDeletedAt),
  )).limit(1);
  const businessId = seedOwner ? await createBusinessForNameSetup() : SEED_BUSINESS_ID;
  if (!seedOwner) await requireSeedBusinessNameSetup();
  const [user] = await db.insert(appUsersTable).values({
    firebaseUid,
    verifiedEmail: email,
    displayName: displayName?.trim() || null,
    businessId,
    role: "owner",
  }).returning();
  await linkUserBusiness(user!.id, businessId);
  return user!;
}

export async function getOrCreatePhoneUser(
  phone: string,
): Promise<AppUser> {
  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.phone, phone));
  if (existing) {
    if (existing.workerAccessDeletedAt) {
      return (await claimWorkerInvite({ phone }, existing)) ?? existing;
    }
    await linkUserBusiness(existing.id, existing.businessId);
    return existing;
  }

  const [deletedAccount] = await db.select({ id: appUsersTable.id }).from(appUsersTable)
    .where(and(
      eq(appUsersTable.phone, hashDeletedAccountIdentity("phone", phone)),
      eq(appUsersTable.role, "owner"),
      isNotNull(appUsersTable.workerAccessDeletedAt),
    )).limit(1);

  const staff = await claimWorkerInvite({ phone });
  if (staff) return staff;
  if (!deletedAccount && !await isPreapproved("phone", phone)) {
    throw new PreapprovalRequiredError("phone", phone);
  }

  const [seedOwner] = await db
    .select()
    .from(appUsersTable)
    .where(and(
      eq(appUsersTable.businessId, SEED_BUSINESS_ID),
      eq(appUsersTable.role, "owner"),
      isNull(appUsersTable.workerAccessDeletedAt),
    ))
    .limit(1);

  let businessId: string;
  if (!seedOwner) {
    businessId = SEED_BUSINESS_ID;
    await requireSeedBusinessNameSetup();
  } else {
    businessId = await createBusinessForNameSetup();
  }

  const [user] = await db
    .insert(appUsersTable)
    .values({ phone, businessId, role: "owner" })
    .returning();
  await linkUserBusiness(user!.id, businessId);
  return user!;
}

// ─── Business-id resolution ───────────────────────────────────────────────────

/**
 * Resolve the business requested by the client. Owners may select any business
 * in their user_businesses membership list. Staff remain in their assigned
 * business. An unrecognized selection is denied rather than silently serving
 * the owner's default business under the wrong client-side account label.
 */
async function resolveBusinessId(
  user: AppUser,
  req: Request,
): Promise<string | null> {
  const [ownMembership] = await db.select().from(userBusinessesTable).where(and(
    eq(userBusinessesTable.userId, user.id),
    eq(userBusinessesTable.businessId, user.businessId),
  )).limit(1);
  if (!ownMembership) return null;
  if (user.role === "staff") return user.businessId;
  const requested = req.get("x-business-id")?.trim();
  if (!requested || requested === user.businessId) return user.businessId;

  const [membership] = await db
    .select()
    .from(userBusinessesTable)
    .where(
      and(
        eq(userBusinessesTable.userId, user.id),
        eq(userBusinessesTable.businessId, requested),
      ),
    )
    .limit(1);

  return membership ? membership.businessId : null;
}

// ─── Phone-session JWT ───────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET!;
const COOKIE_NAME = "phone_session";
const FIREBASE_COOKIE_NAME = "firebase_session";
// Browsers cap persistent cookies at roughly 400 days. Renew the cookie on
// authenticated requests so active phone sessions remain signed in until logout.
export const PHONE_SESSION_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
export const FIREBASE_SESSION_COOKIE_MAX_AGE_MS = PHONE_SESSION_COOKIE_MAX_AGE_MS;
export const NATIVE_WEBVIEW_SESSION_HEADER = "x-banglakhata-native-session";

interface PhoneSessionPayload {
  userId: string;
  businessId?: string;
  phone: string;
  sessionVersion: number;
}

interface FirebaseSessionPayload {
  userId: string;
  businessId: string;
  firebaseUid: string;
  sessionVersion: number;
}

export function isNativeWebViewSessionExchange(req: Request): boolean {
  return req.get(NATIVE_WEBVIEW_SESSION_HEADER) === "1"
    && Boolean(req.headers.authorization?.startsWith("Bearer "));
}

export function issuePhoneSession(
  res: Response,
  payload: PhoneSessionPayload,
): void {
  // Sign only application claims to strip exp/iat from tokens created by old clients.
  // Explicit logout increments phoneSessionVersion server-side.
  const token = jwt.sign({
    userId: payload.userId,
    businessId: payload.businessId,
    phone: payload.phone,
    sessionVersion: payload.sessionVersion,
  }, SESSION_SECRET);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PHONE_SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearPhoneSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function issueFirebaseSession(res: Response, payload: FirebaseSessionPayload): void {
  const token = jwt.sign(payload, SESSION_SECRET);
  res.cookie(FIREBASE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: FIREBASE_SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearFirebaseSession(res: Response): void {
  res.clearCookie(FIREBASE_COOKIE_NAME, { path: "/" });
}

function verifyFirebaseSession(token: string): FirebaseSessionPayload | null {
  try {
    const value = jwt.verify(token, SESSION_SECRET) as Partial<FirebaseSessionPayload>;
    if (
      typeof value.userId !== "string"
      || typeof value.businessId !== "string"
      || typeof value.firebaseUid !== "string"
      || !Number.isInteger(value.sessionVersion)
    ) return null;
    return value as FirebaseSessionPayload;
  } catch {
    return null;
  }
}

function verifyPhoneSession(token: string): PhoneSessionPayload | null {
  try {
    // Older mobile clients hold signed tokens with a 30-day exp. Session
    // version/status checks below are the revocation boundary for all phone JWTs.
    return jwt.verify(token, SESSION_SECRET, { ignoreExpiration: true }) as PhoneSessionPayload;
  } catch {
    return null;
  }
}

// Fixed UUID for the dev-bypass user (development only, never used in prod).
const DEV_USER_ID = "00000000-0000-0000-0000-000000000002";

// ─── requireAuth middleware ───────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const isNativeSessionExchange = isNativeWebViewSessionExchange(req);
  const hasWebViewSessionCookie = Boolean(
    (req as any).cookies?.[FIREBASE_COOKIE_NAME]
    || (req as any).cookies?.[COOKIE_NAME],
  );

  // ── 0. Development bypass — NEVER active when NODE_ENV=production ──────────
  if (
    process.env.NODE_ENV !== "production"
    && process.env.DEV_AUTH_BYPASS === "true"
    && !isNativeSessionExchange
    && !hasWebViewSessionCookie
  ) {
    try {
      // Ensure a stable dev user exists (idempotent, uses fixed UUID).
      await db
        .insert(appUsersTable)
        .values({ id: DEV_USER_ID, businessId: SEED_BUSINESS_ID, role: "owner" })
        .onConflictDoNothing();
      await db
        .insert(userBusinessesTable)
        .values({ userId: DEV_USER_ID, businessId: SEED_BUSINESS_ID })
        .onConflictDoNothing();
      const [devUser] = await db.select().from(appUsersTable)
        .where(eq(appUsersTable.id, DEV_USER_ID)).limit(1);
      if (!devUser || devUser.status !== "active") {
        res.status(403).json({ error: "Account suspended" });
        return;
      }
      const businessId = await resolveBusinessId(devUser, req);
      if (!businessId) {
        res.status(403).json({ error: "Business access denied" });
        return;
      }
      (req as AuthenticatedRequest).userId = DEV_USER_ID;
      (req as AuthenticatedRequest).businessId = businessId;
      (req as AuthenticatedRequest).role = devUser.role;
      (req as AuthenticatedRequest).status = "active";
      (req as AuthenticatedRequest).authMethod = "dev";
      return next();
    } catch (err) {
      req.log?.warn({ err }, "[requireAuth] Dev bypass setup failed; falling through to real auth");
      // Fall through to real auth if the bypass setup fails.
    }
  }

  // ── Try persistent Firebase-backed browser session ──
  const firebaseCookie = (req as any).cookies?.[FIREBASE_COOKIE_NAME];
  if (firebaseCookie) {
    const payload = verifyFirebaseSession(firebaseCookie);
    if (payload) {
      const [user] = await db.select().from(appUsersTable)
        .where(eq(appUsersTable.id, payload.userId)).limit(1);
      if (
        !user
        || user.status !== "active"
        || user.workerAccessDeletedAt
        || user.firebaseUid !== payload.firebaseUid
        || user.phoneSessionVersion !== payload.sessionVersion
      ) {
        clearFirebaseSession(res);
        res.status(401).json({ error: "Invalid or revoked session" });
        return;
      }
      const businessId = await resolveBusinessId(user, req);
      if (!businessId) {
        res.status(403).json({ error: "Business access denied" });
        return;
      }
      issueFirebaseSession(res, { ...payload, businessId });
      const authReq = req as AuthenticatedRequest;
      authReq.userId = user.id;
      authReq.businessId = businessId;
      authReq.role = user.role;
      authReq.status = user.status;
      authReq.authMethod = "firebase";
      authReq.verifiedEmail = user.verifiedEmail ?? undefined;
      return next();
    }
    clearFirebaseSession(res);
  }

  // ── 3. Try phone session cookie ──
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  const bearerHeader = req.headers.authorization;
  const bearerToken = bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : undefined;
  if (cookieToken || bearerToken) {
    const token = cookieToken || bearerToken!;
    const payload = verifyPhoneSession(token);
    if (payload) {
      const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, payload.userId)).limit(1);
       if (user?.workerAccessDeletedAt) {
         clearPhoneSession(res);
         res.status(403).json({
           error: "Staff access removed. Ask the owner for a new invitation.",
           code: "STAFF_ACCESS_REVOKED",
         });
         return;
       }
       if (!user || user.status !== "active" || user.phone !== payload.phone ||
          user.phoneSessionVersion !== payload.sessionVersion) {
        res.status(401).json({ error: "Invalid or revoked session" });
        return;
      }
      const businessId = await resolveBusinessId(user, req);
      if (!businessId) {
        res.status(403).json({ error: "Business access denied" });
        return;
      }
      if (cookieToken) issuePhoneSession(res, payload);
      (req as AuthenticatedRequest).userId = user.id;
      (req as AuthenticatedRequest).businessId = businessId;
      (req as AuthenticatedRequest).role = user.role;
      (req as AuthenticatedRequest).status = user.status;
      (req as AuthenticatedRequest).authMethod = "phone";
      (req as AuthenticatedRequest).phone = user.phone ?? undefined;
      return next();
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}

