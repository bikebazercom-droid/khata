import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  db,
  appUsersTable,
  businessesTable,
  businessSettingsTable,
  partiesTable,
  type AppUser,
} from "@workspace/db";

// Fixed UUID for the seed business that owns all pre-auth legacy data.
// This business is created on startup and the first user to sign in claims it.
export const SEED_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;
  businessId: string;
}

// ─── Startup migration ───────────────────────────────────────────────────────

/**
 * Ensures the seed business exists and all legacy (pre-auth) parties and
 * settings rows are assigned to it. Safe to call repeatedly — all operations
 * are idempotent.
 */
export async function ensureDefaultBusiness(): Promise<void> {
  try {
    await db
      .insert(businessesTable)
      .values({ id: SEED_BUSINESS_ID, name: "My Business" })
      .onConflictDoNothing();

    await db
      .update(partiesTable)
      .set({ businessId: SEED_BUSINESS_ID })
      .where(isNull(partiesTable.businessId));

    await db
      .update(businessSettingsTable)
      .set({ businessId: SEED_BUSINESS_ID })
      .where(isNull(businessSettingsTable.businessId));
  } catch (err) {
    console.error("[startup] ensureDefaultBusiness failed:", err);
  }
}

// ─── JIT user provisioning ───────────────────────────────────────────────────

export async function getOrCreateClerkUser(
  clerkUserId: string,
): Promise<AppUser> {
  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId));
  if (existing) return existing;

  // First login: check if the seed business is still unclaimed.
  const [seedOwner] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.businessId, SEED_BUSINESS_ID))
    .limit(1);

  let businessId: string;
  if (!seedOwner) {
    // Claim the seed business and all its legacy data.
    businessId = SEED_BUSINESS_ID;
  } else {
    // Seed business already claimed — create a fresh business for this user.
    const [biz] = await db.insert(businessesTable).values({}).returning();
    businessId = biz!.id;
    // Ensure default settings exist for the new business.
    await db
      .insert(businessSettingsTable)
      .values({ businessId })
      .onConflictDoNothing();
  }

  const [user] = await db
    .insert(appUsersTable)
    .values({ clerkUserId, businessId, role: "owner" })
    .returning();
  return user!;
}

export async function getOrCreatePhoneUser(
  phone: string,
): Promise<AppUser> {
  const [existing] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.phone, phone));
  if (existing) return existing;

  // Same seed-business claim logic as Clerk path.
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
  return user!;
}

// ─── Phone-session JWT ───────────────────────────────────────────────────────

const SESSION_SECRET = process.env.SESSION_SECRET!;
const COOKIE_NAME = "phone_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

function verifyPhoneSession(
  token: string,
): PhoneSessionPayload | null {
  try {
    return jwt.verify(token, SESSION_SECRET) as PhoneSessionPayload;
  } catch {
    return null;
  }
}

// ─── requireAuth middleware ───────────────────────────────────────────────────

/**
 * Accepts either a valid Clerk session cookie (email / Google sign-in) or a
 * valid `phone_session` JWT cookie (custom Bangladeshi phone OTP sign-in).
 * Sets `req.userId` and `req.businessId` on success; returns 401 otherwise.
 */
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
      (req as AuthenticatedRequest).businessId = user.businessId;
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
      (req as AuthenticatedRequest).userId = payload.userId;
      (req as AuthenticatedRequest).businessId = payload.businessId;
      return next();
    }
  }

  // ── 3. Try phone session Bearer token (mobile clients) ──
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7);
    const payload = verifyPhoneSession(bearerToken);
    if (payload) {
      (req as AuthenticatedRequest).userId = payload.userId;
      (req as AuthenticatedRequest).businessId = payload.businessId;
      return next();
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}
