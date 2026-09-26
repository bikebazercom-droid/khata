import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq, isNull, isNotNull, and, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  db,
  appUsersTable,
  appUserLoginSessionsTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  userBusinessesTable,
  workerInvitesTable,
  workerPartyAssignmentsTable,
  type AppUser,
} from "@workspace/db";

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
    const [updatedStaff] = await tx.update(appUsersTable).set({
      adjustmentPartyIds: invite.adjustmentPartyIds.filter((id) => eligiblePartyIds.some((p) => p.id === id)),
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
 * If the request carries an `X-Business-Id` header and the user owns that
 * business (has a row in user_businesses), use it; otherwise fall back to the
 * user's default businessId.
 */
async function resolveBusinessId(
  user: AppUser,
  req: Request,
): Promise<string> {
  const [ownMembership] = await db.select().from(userBusinessesTable).where(and(
    eq(userBusinessesTable.userId, user.id),
    eq(userBusinessesTable.businessId, user.businessId),
  )).limit(1);
  if (!ownMembership) throw new Error("Business membership required");
  if (user.role === "staff") return user.businessId;
  const requested = req.headers["x-business-id"] as string | undefined;
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

  return membership ? membership.businessId : user.businessId;
}

// ─── Phone-session JWT ───────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET!;
const COOKIE_NAME = "phone_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface PhoneSessionPayload {
  userId: string;
  businessId?: string;
  phone: string;
  sessionVersion: number;
}

export function issuePhoneSession(
  res: Response,
  payload: PhoneSessionPayload,
): void {
  const token = jwt.sign(payload, SESSION_SECRET, { expiresIn: "30d" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearPhoneSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function verifyPhoneSession(token: string): PhoneSessionPayload | null {
  try {
    return jwt.verify(token, SESSION_SECRET) as PhoneSessionPayload;
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
  // ── 0. Development bypass — NEVER active when NODE_ENV=production ──────────
  if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true") {
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
      (req as AuthenticatedRequest).userId = DEV_USER_ID;
      (req as AuthenticatedRequest).businessId = SEED_BUSINESS_ID;
      (req as AuthenticatedRequest).role = "owner";
      (req as AuthenticatedRequest).status = "active";
      (req as AuthenticatedRequest).authMethod = "dev";
      return next();
    } catch (err) {
      console.warn("[requireAuth] dev-bypass setup error — falling through to real auth:", err);
      // Fall through to real auth if the bypass setup fails.
    }
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
        const response = await fetch(`https://api.clerk.com/v1/sessions/${encodeURIComponent(clerkAuth.sessionId)}`, {
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        });
        if (!response.ok) throw new Error("Could not verify session creation time");
        const session = await response.json() as { created_at?: number; user_id?: string };
        if (session.user_id !== clerkAuth.userId || typeof session.created_at !== "number" ||
          session.created_at <= cutoff.revokedAt.getTime()) {
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
        }
        return true;
      });
      if (!sessionAllowed) {
        res.status(401).json({ error: "Session signed out" });
        return;
      }
      (req as AuthenticatedRequest).userId = user.id;
      (req as AuthenticatedRequest).businessId = await resolveBusinessId(user, req);
      (req as AuthenticatedRequest).role = user.role;
      (req as AuthenticatedRequest).status = user.status;
      (req as AuthenticatedRequest).authMethod = "clerk";
      (req as AuthenticatedRequest).clerkSessionId = clerkAuth.sessionId;
      (req as AuthenticatedRequest).verifiedEmail = verifiedEmail ?? undefined;
      return next();
    } catch (err) {
      console.error("[requireAuth] Clerk JIT provision error:", err);
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
      const [membership] = await db.select().from(userBusinessesTable).where(and(
        eq(userBusinessesTable.userId, user.id),
        eq(userBusinessesTable.businessId, user.businessId),
      )).limit(1);
      if (!membership) {
        res.status(403).json({ error: "Business membership required" });
        return;
      }
      (req as AuthenticatedRequest).userId = user.id;
      (req as AuthenticatedRequest).businessId = user.businessId;
      (req as AuthenticatedRequest).role = user.role;
      (req as AuthenticatedRequest).status = user.status;
      (req as AuthenticatedRequest).authMethod = "phone";
      (req as AuthenticatedRequest).phone = user.phone ?? undefined;
      return next();
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}

async function getVerifiedClerkEmail(clerkUserId: string): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return null;
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) return null;
    const user = await response.json() as {
      email_addresses?: Array<{ id: string; email_address: string; verification?: { status?: string } }>;
      primary_email_address_id?: string;
    };
    const item = user.email_addresses?.find((email) =>
      email.id === user.primary_email_address_id && email.verification?.status === "verified",
    ) ?? user.email_addresses?.find((email) => email.verification?.status === "verified");
    return item?.email_address.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}
