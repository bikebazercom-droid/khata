import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq, isNull, and } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  db,
  appUsersTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  userBusinessesTable,
  type AppUser,
} from "@workspace/db";

// Fixed UUID for the seed business that owns all pre-auth legacy data.
export const SEED_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;
  businessId: string;
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

export async function getOrCreateClerkUser(
  clerkUserId: string,
): Promise<AppUser> {
  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId));
  if (existing) {
    // Ensure the user_businesses entry exists (idempotent backfill)
    await linkUserBusiness(existing.id, existing.businessId);
    return existing;
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
    .values({ clerkUserId, businessId, role: "owner" })
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
    await linkUserBusiness(existing.id, existing.businessId);
    return existing;
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
  businessId: string;
  phone: string;
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

// ─── requireAuth middleware ───────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ── 1. Try Clerk ──
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    try {
      const user = await getOrCreateClerkUser(clerkAuth.userId);
      (req as AuthenticatedRequest).userId = user.id;
      (req as AuthenticatedRequest).businessId = await resolveBusinessId(user, req);
      return next();
    } catch (err) {
      console.error("[requireAuth] Clerk JIT provision error:", err);
      res.status(500).json({ error: "Auth provisioning failed" });
      return;
    }
  }

  // ── 2. Try phone session cookie ──
  const cookieToken = (req as any).cookies?.[COOKIE_NAME];
  if (cookieToken) {
    const payload = verifyPhoneSession(cookieToken);
    if (payload) {
      const fakeUser = { id: payload.userId, businessId: payload.businessId } as AppUser;
      (req as AuthenticatedRequest).userId = payload.userId;
      (req as AuthenticatedRequest).businessId = await resolveBusinessId(fakeUser, req);
      return next();
    }
  }

  // ── 3. Try phone session Bearer token (mobile clients) ──
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7);
    const payload = verifyPhoneSession(bearerToken);
    if (payload) {
      const fakeUser = { id: payload.userId, businessId: payload.businessId } as AppUser;
      (req as AuthenticatedRequest).userId = payload.userId;
      (req as AuthenticatedRequest).businessId = await resolveBusinessId(fakeUser, req);
      return next();
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}
