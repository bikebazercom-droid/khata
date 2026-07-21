/**
 * Phone OTP authentication routes.
 *
 * These are intentionally public (no requireAuth middleware). They either
 * issue a session or verify identity.
 *
 * SMS delivery: currently stores the OTP in the database. Twilio wiring
 * will be added once the Twilio integration is connected.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import {
  db,
  otpCodesTable,
  appUsersTable,
  businessesTable,
} from "@workspace/db";
import {
  getOrCreateClerkUser,
  getOrCreatePhoneUser,
  issuePhoneSession,
  clearPhoneSession,
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

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
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

    // Per-phone cooldown: reject if an OTP was already issued within the last 60 seconds.
    // This prevents SMS flooding even when requests come from different IP addresses.
    const [recent] = await db
      .select({ createdAt: otpCodesTable.createdAt })
      .from(otpCodesTable)
      .where(
        and(
          eq(otpCodesTable.phone, normalized),
          gt(otpCodesTable.createdAt, new Date(Date.now() - 60 * 1000)),
        ),
      )
      .limit(1);

    if (recent) {
      res.status(429).json({
        error: "An OTP was already sent to this number. Please wait 60 seconds before requesting a new one.",
      });
      return;
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert: replace any existing OTP for this phone.
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, normalized));
    await db.insert(otpCodesTable).values({ phone: normalized, code, expiresAt });

    // TODO: Send via Twilio once connected.
    // The OTP code is intentionally NOT logged here to prevent credential exposure
    // in server logs, log aggregators, or the Replit console.
    console.log(`[OTP] Code issued for ${normalized} (expires ${expiresAt.toISOString()})`);

    res.json({ success: true, phone: normalized });
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

    const sessionPayload = {
      userId: user.id,
      businessId: user.businessId,
      phone: normalized,
    };

    issuePhoneSession(res, sessionPayload);

    // Also return the JWT token in the response body so mobile clients
    // (which have no cookie jar) can store it in SecureStore and attach
    // it as a Bearer token on subsequent API requests.
    const jwt = await import("jsonwebtoken");
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

router.post("/auth/phone/logout", (_req: Request, res: Response): Promise<void> => {
  clearPhoneSession(res);
  res.json({ success: true });
  return Promise.resolve();
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  // Works for both Clerk and phone sessions.
  const clerkAuth = getAuth(req);
  if (clerkAuth?.userId) {
    try {
      const user = await getOrCreateClerkUser(clerkAuth.userId);
      const [biz] = await db
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, user.businessId));
      res.json({ userId: user.id, businessId: user.businessId, businessName: biz?.name, authMethod: "clerk" });
      return;
    } catch {
      res.status(500).json({ error: "Auth error" });
      return;
    }
  }

  const token = (req as any).cookies?.phone_session;
  if (token) {
    try {
      const jwt = await import("jsonwebtoken");
      const payload = jwt.verify(token, process.env.SESSION_SECRET!) as any;
      const [biz] = await db
        .select()
        .from(businessesTable)
        .where(eq(businessesTable.id, payload.businessId));
      res.json({ userId: payload.userId, businessId: payload.businessId, businessName: biz?.name, phone: payload.phone, authMethod: "phone" });
      return;
    } catch {
      // invalid/expired — fall through to 401
    }
  }

  res.status(401).json({ error: "Not authenticated" });
});

export default router;
