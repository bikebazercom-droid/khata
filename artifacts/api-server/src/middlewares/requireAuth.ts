import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq, isNull, isNotNull, and, inArray, lt } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  db,
  appUsersTable,
  appUserLoginSessionsTable,
  userLoginEventsTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  userBusinessesTable,
  workerInvitesTable,
  workerPartyAssignmentsTable,
  type AppUser,
} from "@workspace/db";
import { clientIp } from "./ipBlock";
import { deviceDescription } from "../lib/authTelemetry";

// Fixed UUID for the seed business that owns all pre-auth legacy data.
export const SEED_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
  status: "active" | "suspended";
  authMethod: "clerk" | "phone" | "dev";
  clerkSessionId?: string;
  verifiedEmail?: string;
  phone?: string;
}

// ─── Startup migration ───────────────────────────────────────────────────────

export async function ensureDefaultBusiness(): Promise<void> {
  try {
    await db
      .insert(businessesTable)
      .values({ id: SEED_BUSINESS_ID, name: "আমার খাতা" })
      .onConflictDoNothing();

    await db
      .update(partiesTable)
      .set({ businessId: SEED_BUSINESS_ID })
      .where(isNull(partiesTable.businessId));

    await db
      .update(businessSettingsTable)
      .set({ businessId: SEED_BUSINESS_ID })
      .where(isNull(businessSettingsTable.businessId));

    // Backfill user_businesses for any existing app_users rows
    const existingUsers = await db.select().from(appUsersTable);
    for (const u of existingUsers) {
      if (u.workerAccessDeletedAt) continue;
      await db
        .insert(userBusinessesTable)
        .values({ userId: u.id, businessId: u.businessId })
        .onConflictDoNothing();
    }
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

async function claimWorkerInvite(identity: { email?: string; phone?: string; clerkUserId?: string }, existing?: AppUser) {
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
    }).where(and(eq(appUsersTable.id, existing.id), eq(appUsersTable.status, "suspended"),
      isNotNull(appUsersTable.workerAccessDeletedAt)))
      .returning() : await tx.insert(appUsersTable).values({
      clerkUserId: identity.clerkUserId,
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

export async function getOrCreateClerkUser(
  clerkUserId: string,
  verifiedEmail?: string,
): Promise<AppUser> {
  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId));
  if (existing) {
    if (existing.workerAccessDeletedAt) {
      // Never turn a removed staff identity into an owner. Only a new owner-issued
      // invitation and a freshly verified matching identity can restore access.
      if (!verifiedEmail || verifiedEmail !== existing.verifiedEmail) return existing;
      return (await claimWorkerInvite({ email: verifiedEmail, clerkUserId }, existing)) ?? existing;
    }
    if (verifiedEmail && existing.verifiedEmail !== verifiedEmail) {
      const [updated] = await db.update(appUsersTable)
        .set({ verifiedEmail }).where(eq(appUsersTable.id, existing.id)).returning();
      await linkUserBusiness(existing.id, existing.businessId);
      return updated!;
    }
    // Ensure the user_businesses entry exists (idempotent backfill)
    await linkUserBusiness(existing.id, existing.businessId);
    return existing;
  }

  if (!verifiedEmail) {
    throw new Error("A verified Clerk email is required to provision a new account");
  }

  if (verifiedEmail) {
    const [existingEmail] = await db.select({ id: appUsersTable.id }).from(appUsersTable)
      .where(eq(appUsersTable.verifiedEmail, verifiedEmail)).limit(1);
    if (existingEmail) throw new Error("Verified email is already linked to another user");
    const staff = await claimWorkerInvite({ email: verifiedEmail, clerkUserId });
    if (staff) return staff;
  }

  const [seedOwner] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.businessId, SEED_BUSINESS_ID))
    .limit(1);

  let businessId: string;
  if (!seedOwner) {
    businessId = SEED_BUSINESS_ID;
  } else {
    const [biz] = await db.insert(businessesTable).values({}).returning();
    businessId = biz!.id;
    await db
      .insert(businessSettingsTable)
      .values({ businessId })
      .onConflictDoNothing();
  }

  const [user] = await db
    .insert(appUsersTable)
    .values({ clerkUserId, verifiedEmail, businessId, role: "owner" })
    .returning();
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

  const staff = await claimWorkerInvite({ phone });
  if (staff) return staff;

  const [seedOwner] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.businessId, SEED_BUSINESS_ID))
    .limit(1);

  let businessId: string;
  if (!seedOwner) {
    businessId = SEED_BUSINESS_ID;
  } else {
    const [biz] = await db.insert(businessesTable).values({}).returning();
    businessId = biz!.id;
    await db
      .insert(businessSettingsTable)
      .values({ businessId })
      .onConflictDoNothing();
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

// One end-to-end budget per provider lookup, covering headers and JSON decoding.
// Abort releases network resources; the race also bounds transports ignoring abort.
export const CLERK_SESSION_METADATA_TIMEOUT_MS = 5_000;

async function fetchClerkMetadata(url: string, failureMessage: string): Promise<unknown> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("Clerk secret key is required to verify identity");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(new Error(`${failureMessage}: timed out`));
    }, CLERK_SESSION_METADATA_TIMEOUT_MS);
  });
  const lookup = (async () => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    if (expired) {
      // A transport that ignores abort may still return headers after timeout.
      void response.body?.cancel().catch(() => {});
      throw new Error(`${failureMessage}: timed out`);
    }
    if (!response.ok) throw new Error(failureMessage);
    return response.json();
  })();
  try {
    return await Promise.race([lookup, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Also stop a stalled body on any error; on success it has been consumed.
    controller.abort();
  }
}

export async function verifyClerkSessionCreationTime(
  sessionId: string,
  userId: string,
  cutoff: Date,
): Promise<boolean> {
  const session = await fetchClerkMetadata(
    `https://api.clerk.com/v1/sessions/${encodeURIComponent(sessionId)}`,
    "Could not verify session creation time",
  ) as { id?: string; created_at?: number; user_id?: string } | null;
  return !!session && session.id === sessionId && session.user_id === userId &&
    typeof session.created_at === "number" && Number.isFinite(session.created_at) &&
    session.created_at > cutoff.getTime();
}

// ─── Phone-session JWT ───────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET!;
const COOKIE_NAME = "phone_session";
// Browsers cap persistent cookies at roughly 400 days. Renew the cookie on
// authenticated requests so active phone sessions remain signed in until logout.
export const PHONE_SESSION_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
export const CLERK_WEBVIEW_SESSION_COOKIE_MAX_AGE_MS = PHONE_SESSION_COOKIE_MAX_AGE_MS;
const CLERK_WEBVIEW_SESSION_COOKIE_NAME = "clerk_webview_session";
export const NATIVE_WEBVIEW_SESSION_HEADER = "x-banglakhata-native-session";

interface PhoneSessionPayload {
  userId: string;
  businessId?: string;
  phone: string;
  sessionVersion: number;
}

interface ClerkWebViewSessionPayload {
  type: "clerk-webview";
  userId: string;
  clerkUserId: string;
  sessionId: string;
}

export function issueClerkWebViewSession(
  res: Response,
  payload: Omit<ClerkWebViewSessionPayload, "type">,
): void {
  const token = jwt.sign({ ...payload, type: "clerk-webview" }, SESSION_SECRET);
  res.cookie(CLERK_WEBVIEW_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CLERK_WEBVIEW_SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearClerkWebViewSession(res: Response): void {
  res.clearCookie(CLERK_WEBVIEW_SESSION_COOKIE_NAME, { path: "/" });
}

export function isNativeWebViewSessionExchange(req: Request): boolean {
  return req.get(NATIVE_WEBVIEW_SESSION_HEADER) === "1"
    && Boolean(req.headers.authorization?.startsWith("Bearer "));
}

function verifyClerkWebViewSession(token: string): ClerkWebViewSessionPayload | null {
  try {
    const decoded = jwt.verify(token, SESSION_SECRET) as Partial<ClerkWebViewSessionPayload>;
    if (
      decoded.type !== "clerk-webview"
      || typeof decoded.userId !== "string"
      || typeof decoded.clerkUserId !== "string"
      || typeof decoded.sessionId !== "string"
    ) return null;
    return decoded as ClerkWebViewSessionPayload;
  } catch {
    return null;
  }
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
    (req as any).cookies?.[CLERK_WEBVIEW_SESSION_COOKIE_NAME]
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

  // Native Clerk tokens are exchanged for this signed, HttpOnly cookie inside
  // the WebView. The exchange itself must still authenticate with its bearer
  // token so a previous cookie cannot select a different native account.
  const rawWebViewSession = (req as any).cookies?.[CLERK_WEBVIEW_SESSION_COOKIE_NAME];
  if (typeof rawWebViewSession === "string" && !isNativeSessionExchange) {
    const webViewSession = verifyClerkWebViewSession(rawWebViewSession);
    if (webViewSession) {
      try {
        const [user] = await db.select().from(appUsersTable)
          .where(eq(appUsersTable.id, webViewSession.userId)).limit(1);
        const [session] = await db.select().from(appUserLoginSessionsTable)
          .where(and(
            eq(appUserLoginSessionsTable.userId, webViewSession.userId),
            eq(appUserLoginSessionsTable.sessionId, webViewSession.sessionId),
          )).limit(1);
        const [revokedWorkerAccess] = await db.select({
          revokedAt: appUserLoginSessionsTable.revokedAt,
        }).from(appUserLoginSessionsTable).where(and(
          eq(appUserLoginSessionsTable.userId, webViewSession.userId),
          eq(appUserLoginSessionsTable.sessionId, "worker-access-revoked"),
        )).limit(1);
        const workerSessionIsCurrent = !revokedWorkerAccess?.revokedAt
          || await verifyClerkSessionCreationTime(
            webViewSession.sessionId,
            webViewSession.clerkUserId,
            revokedWorkerAccess.revokedAt,
          );

        if (
          user
          && user.clerkUserId === webViewSession.clerkUserId
          && user.status === "active"
          && !user.workerAccessDeletedAt
          && session
          && !session.revokedAt
          && workerSessionIsCurrent
        ) {
          const businessId = await resolveBusinessId(user, req);
          if (businessId) {
            const authReq = req as AuthenticatedRequest;
            authReq.userId = user.id;
            authReq.businessId = businessId;
            authReq.role = user.role as "owner" | "staff";
            authReq.status = user.status;
            authReq.authMethod = "clerk";
            authReq.clerkSessionId = webViewSession.sessionId;
            authReq.verifiedEmail = user.verifiedEmail ?? undefined;
            issueClerkWebViewSession(res, webViewSession);
            return next();
          }
        }
      } catch (err) {
        req.log?.error({ err }, "[requireAuth] Native WebView session validation failed");
        res.status(500).json({ error: "Unable to verify session" });
        return;
      }
    }
    clearClerkWebViewSession(res);
  }

  // ── 1. Try Clerk ──
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    try {
      if (!clerkAuth.sessionId) {
        res.status(401).json({ error: "A Clerk user session is required" });
        return;
      }
      // Check revoked sessions before JIT re-claim; an old token cannot consume
      // a fresh invitation or regain access after the membership is restored.
      const [oldSession] = await db.select({ revokedAt: appUserLoginSessionsTable.revokedAt })
        .from(appUserLoginSessionsTable)
        .innerJoin(appUsersTable, eq(appUsersTable.id, appUserLoginSessionsTable.userId))
        .where(and(eq(appUsersTable.clerkUserId, clerkAuth.userId),
          eq(appUserLoginSessionsTable.sessionId, clerkAuth.sessionId))).limit(1);
      if (oldSession?.revokedAt) { res.status(401).json({ error: "Session signed out" }); return; }
      const [cutoff] = await db.select({ revokedAt: appUserLoginSessionsTable.revokedAt })
        .from(appUserLoginSessionsTable)
        .innerJoin(appUsersTable, eq(appUsersTable.id, appUserLoginSessionsTable.userId))
        .where(and(eq(appUsersTable.clerkUserId, clerkAuth.userId),
          eq(appUserLoginSessionsTable.sessionId, "worker-access-revoked"))).limit(1);
      if (cutoff?.revokedAt) {
        if (!await verifyClerkSessionCreationTime(clerkAuth.sessionId, clerkAuth.userId, cutoff.revokedAt)) {
          res.status(401).json({ error: "Staff access was removed. Please sign in with a new session." });
          return;
        }
      }
      const verifiedEmail = await getVerifiedClerkEmail(clerkAuth.userId);
      const user = await getOrCreateClerkUser(clerkAuth.userId, verifiedEmail ?? undefined);
      if (user.status !== "active" || user.workerAccessDeletedAt) {
        res.status(403).json({ error: user.workerAccessDeletedAt
          ? "Staff access removed. Ask the owner for a new invitation." : "Account suspended" });
        return;
      }
      const sessionAllowed = await db.transaction(async (tx) => {
        const [currentUser] = await tx.select().from(appUsersTable)
          .where(eq(appUsersTable.id, user.id)).for("update").limit(1);
        if (!currentUser || currentUser.status !== "active" || currentUser.workerAccessDeletedAt) return false;
        const [currentCutoff] = await tx.select().from(appUserLoginSessionsTable).where(and(
          eq(appUserLoginSessionsTable.userId, user.id),
          eq(appUserLoginSessionsTable.sessionId, "worker-access-revoked"),
        )).limit(1);
        if ((currentCutoff?.revokedAt?.getTime() ?? 0) !== (cutoff?.revokedAt?.getTime() ?? 0)) return false;
        const [newSession] = await tx.insert(appUserLoginSessionsTable).values({
          userId: user.id,
          sessionId: clerkAuth.sessionId!,
        }).onConflictDoNothing().returning({ sessionId: appUserLoginSessionsTable.sessionId });
        const [session] = await tx.select({ revokedAt: appUserLoginSessionsTable.revokedAt })
          .from(appUserLoginSessionsTable).where(and(
            eq(appUserLoginSessionsTable.userId, user.id),
            eq(appUserLoginSessionsTable.sessionId, clerkAuth.sessionId!),
          )).limit(1);
        if (session?.revokedAt) return false;
        if (newSession) {
          await tx.update(appUsersTable).set({ lastLogin: new Date() })
            .where(eq(appUsersTable.id, user.id));
          await tx.insert(userLoginEventsTable).values({
            userId: user.id, ip: clientIp(req), device: deviceDescription(req),
            authMethod: "clerk", source: req.get("x-client-platform") === "mobile" ? "mobile" : "web",
          });
          await tx.delete(userLoginEventsTable).where(lt(userLoginEventsTable.occurredAt,
            new Date(Date.now() - 90 * 24 * 60 * 60_000)));
        }
        return true;
      });
      if (!sessionAllowed) {
        res.status(401).json({ error: "Session signed out" });
        return;
      }
      const businessId = await resolveBusinessId(user, req);
      if (!businessId) {
        res.status(403).json({ error: "Business access denied" });
        return;
      }
      (req as AuthenticatedRequest).userId = user.id;
      (req as AuthenticatedRequest).businessId = businessId;
      (req as AuthenticatedRequest).role = user.role;
      (req as AuthenticatedRequest).status = user.status;
      (req as AuthenticatedRequest).authMethod = "clerk";
      (req as AuthenticatedRequest).clerkSessionId = clerkAuth.sessionId;
      (req as AuthenticatedRequest).verifiedEmail = verifiedEmail ?? undefined;
      return next();
    } catch (err) {
      req.log?.error({ err }, "[requireAuth] Clerk JIT provision failed");
      res.status(500).json({ error: "Auth provisioning failed" });
      return;
    }
  }

  // ── 2. Try phone session cookie ──
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  const bearerHeader = req.headers.authorization;
  const bearerToken = bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : undefined;
  if (cookieToken || bearerToken) {
    const token = cookieToken || bearerToken!;
    const payload = verifyPhoneSession(token);
    if (payload) {
      const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, payload.userId)).limit(1);
      if (!user || user.status !== "active" || user.workerAccessDeletedAt || user.phone !== payload.phone ||
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

export async function getVerifiedClerkEmail(clerkUserId: string): Promise<string | null> {
  const user = await fetchClerkMetadata(
    `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`,
    "Could not verify Clerk email",
  ) as {
    email_addresses?: Array<{ id: string; email_address: string; verification?: { status?: string } }>;
    primary_email_address_id?: string;
  } | null;
  if (!user) throw new Error("Could not verify Clerk email");
  const item = user.email_addresses?.find((email) =>
    email.id === user.primary_email_address_id && email.verification?.status === "verified",
  ) ?? user.email_addresses?.find((email) => email.verification?.status === "verified");
  return item?.email_address.trim().toLowerCase() ?? null;
}
