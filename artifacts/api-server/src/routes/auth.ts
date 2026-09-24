/**
 * Phone OTP authentication routes.
 *
 * These are intentionally public (no requireAuth middleware). They either
 * issue a session or verify identity.
 *
 * OTP delivery remains disabled until a real SMS provider is configured.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt } from "drizzle-orm";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import {
  db,
  otpCodesTable,
  appUsersTable,
  businessesTable,
} from "@workspace/db";
import {
  getOrCreatePhoneUser,
  issuePhoneSession,
  clearPhoneSession,
  requireAuth,
  type AuthenticatedRequest,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

// Normalize a Bangladeshi phone number to E.164 format.
// Accepts: 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX
function normalizeBdPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^01[3-9]\d{8}$/.test(digits.replace(/^0/, ""))) return null; // odd length
  if (/^\+?8801[3-9]\d{8}$/.test(raw)) return `+88${digits.slice(digits.length - 11)}`;
  return null;
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

/**
 * Send-OTP: 5 requests per IP per 15 minutes.
 * Prevents SMS gateway abuse / phone flooding from a single origin.
 */
const sendOtpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many OTP requests from this IP. Please wait 15 minutes before trying again." },
});

/**
 * Verify-OTP (IP): 10 attempts per IP per 15 minutes.
 * First line of defence against distributed brute-force.
 */
const verifyOtpIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many verification attempts from this IP. Please wait 15 minutes." },
});

/**
 * Verify-OTP (phone): 5 attempts per phone number per 10 minutes.
 * Prevents brute-force from rotating IPs: an attacker cannot guess more than
 * 5 codes per OTP window regardless of how many source IPs they use.
 *
 * The key is the E.164-normalized form so that all equivalent representations
 * of the same number (01…, 8801…, +8801…) are counted against the same bucket.
 */
const verifyOtpPhoneLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  keyGenerator: (req: Request) => {
    const raw = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const normalized = raw ? normalizeBdPhone(raw) : null;
    return `phone:${(normalized ?? raw) || "unknown"}`;
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many verification attempts for this number. Please request a new code." },
});

// ─── POST /api/auth/phone/send-otp ───────────────────────────────────────────

router.post(
  "/auth/phone/send-otp",
  sendOtpIpLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { phone } = req.body ?? {};
    if (typeof phone !== "string" || !phone.trim()) {
      res.status(400).json({ error: "phone is required" });
      return;
    }

    const normalized = normalizeBdPhone(phone.trim());
    if (!normalized) {
      res.status(400).json({
        error: "Invalid Bangladeshi phone number. Use format: 01XXXXXXXXX",
      });
      return;
    }

    // Never create or report an OTP unless a delivery provider actually sends it.
    res.status(503).json({ error: "Phone sign-in is unavailable: SMS delivery is not configured" });
  },
);

// ─── POST /api/auth/phone/verify-otp ─────────────────────────────────────────

router.post(
  "/auth/phone/verify-otp",
  verifyOtpIpLimiter,
  verifyOtpPhoneLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { phone, code } = req.body ?? {};
    if (typeof phone !== "string" || typeof code !== "string") {
      res.status(400).json({ error: "phone and code are required" });
      return;
    }

    const normalized = normalizeBdPhone(phone.trim());
    if (!normalized) {
      res.status(400).json({ error: "Invalid phone number" });
      return;
    }

    const [record] = await db
      .select()
      .from(otpCodesTable)
      .where(
        and(
          eq(otpCodesTable.phone, normalized),
          eq(otpCodesTable.code, code.trim()),
          eq(otpCodesTable.verified, false),
          gt(otpCodesTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!record) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    // Mark OTP as used.
    await db
      .update(otpCodesTable)
      .set({ verified: true })
      .where(eq(otpCodesTable.id, record.id));

    // JIT provision the user + business.
    const user = await getOrCreatePhoneUser(normalized);
    if (user.status !== "active") {
      res.status(403).json({ error: "Account suspended" });
      return;
    }

    const sessionPayload = {
      userId: user.id,
      businessId: user.businessId,
      phone: normalized,
      sessionVersion: user.phoneSessionVersion,
    };

    issuePhoneSession(res, sessionPayload);

    // Also return the JWT token in the response body so mobile clients
    // (which have no cookie jar) can store it in SecureStore and attach
    // it as a Bearer token on subsequent API requests.
    const token = jwt.sign(sessionPayload, process.env.SESSION_SECRET!, { expiresIn: "30d" });

    res.json({
      success: true,
      userId: user.id,
      businessId: user.businessId,
      phone: normalized,
      token,
    });
  },
);

// ─── POST /api/auth/phone/logout ──────────────────────────────────────────────

router.post("/auth/phone/logout", async (req: Request, res: Response): Promise<void> => {
  const token = (req as any).cookies?.phone_session ??
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.SESSION_SECRET!) as {
        userId?: string; phone?: string;
      };
      if (payload.userId && payload.phone) {
        const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, payload.userId)).limit(1);
        if (user?.phone === payload.phone) {
          await db.update(appUsersTable)
            .set({ phoneSessionVersion: user.phoneSessionVersion + 1 })
            .where(eq(appUsersTable.id, user.id));
        }
      }
    } catch {
      // Invalid sessions are already unusable; still clear the browser cookie.
    }
  }
  clearPhoneSession(res);
  res.json({ success: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const auth = req as AuthenticatedRequest;
  const [business] = await db.select({ name: businessesTable.name }).from(businessesTable)
    .where(eq(businessesTable.id, auth.businessId)).limit(1);
  res.json({
    role: auth.role,
    businessId: auth.businessId,
    userId: auth.userId,
    businessName: business?.name ?? "",
    authMethod: auth.authMethod,
    ...(auth.phone ? { phone: auth.phone } : {}),
  });
});

export default router;
