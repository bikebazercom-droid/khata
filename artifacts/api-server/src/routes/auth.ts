/**
 * Phone OTP authentication routes.
 *
 * These are intentionally public (no requireAuth middleware). They either
 * issue a session or verify identity.
 *
 * OTPs are only usable after the SMS provider accepts delivery.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt, inArray, lt } from "drizzle-orm";
import { createHmac, randomInt } from "node:crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import {
  db,
  otpCodesTable,
  appUsersTable,
  appUserLoginSessionsTable,
  userLoginEventsTable,
  userPresenceTable,
  adminOtpConfigTable,
  businessesTable,
  workerPartyAssignmentsTable,
  partiesTable,
} from "@workspace/db";
import {
  getOrCreatePhoneUser,
  issuePhoneSession,
  clearPhoneSession,
  clearClerkWebViewSession,
  isNativeWebViewSessionExchange,
  issueClerkWebViewSession,
  requireAuth,
  type AuthenticatedRequest,
} from "../middlewares/requireAuth";
import { ensureSmsReady, sendOtpSms, SmsGatewayError } from "../services/sms";
import { clientIp } from "../middlewares/ipBlock";
import { deviceDescription } from "../lib/authTelemetry";
import { normalizeBdPhone } from "../lib/bdPhone";
import { PostgresRateLimitStore } from "../lib/postgresRateLimitStore";
import {
  getNormalizedOtpPhoneRateLimitKey,
  getVerifiedOtpIpRateLimitKey,
  shouldSkipOtpIpRateLimit,
} from "../lib/otpRateLimitKeys";

const router: IRouter = Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────

const SEND_OTP_IP_WINDOW_MS = 15 * 60_000;
const SEND_OTP_PHONE_WINDOW_MS = 15 * 60_000;
const VERIFY_OTP_IP_WINDOW_MS = 15 * 60_000;
const VERIFY_OTP_PHONE_WINDOW_MS = 10 * 60_000;

const verifiedOtpIpKey = (req: Request) =>
  getVerifiedOtpIpRateLimitKey(req) ?? "unverified";

/**
 * Send-OTP: 5 requests per IP per 15 minutes.
 * Use only verified client IPs. With no configured IP policy, this one limiter
 * is skipped rather than grouping every user behind a proxy into one bucket;
 * the per-phone limiter remains active.
 */
const sendOtpIpLimiter = rateLimit({
  windowMs: SEND_OTP_IP_WINDOW_MS,
  limit: 5,
  store: new PostgresRateLimitStore("otp-send-ip", SEND_OTP_IP_WINDOW_MS),
  keyGenerator: verifiedOtpIpKey,
  skip: shouldSkipOtpIpRateLimit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many OTP requests from this IP. Please wait 15 minutes before trying again." },
});

const sendOtpPhoneLimiter = rateLimit({
  windowMs: SEND_OTP_PHONE_WINDOW_MS,
  limit: 3,
  store: new PostgresRateLimitStore("otp-send-phone", SEND_OTP_PHONE_WINDOW_MS),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: getNormalizedOtpPhoneRateLimitKey,
  message: { error: "Too many codes requested for this phone. Please try again later." },
});

function otpDigest(phone: string, code: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`${phone}:${code}`).digest("hex");
}

function safeFailureCode(error: unknown): string {
  if (error instanceof SmsGatewayError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
  }
  return error instanceof Error ? error.name : "unknown_error";
}

function smsFailureLogFields(error: unknown) {
  if (!(error instanceof SmsGatewayError)) {
    return { errorCode: safeFailureCode(error) };
  }
  return {
    errorCode: error.code,
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.providerErrorCode !== undefined
      ? { providerErrorCode: error.providerErrorCode }
      : {}),
  };
}

/**
 * Verify-OTP (IP): 10 attempts per IP per 15 minutes.
 * First line of defence against distributed brute-force.
 */
const verifyOtpIpLimiter = rateLimit({
  windowMs: VERIFY_OTP_IP_WINDOW_MS,
  limit: 10,
  store: new PostgresRateLimitStore("otp-verify-ip", VERIFY_OTP_IP_WINDOW_MS),
  keyGenerator: verifiedOtpIpKey,
  skip: shouldSkipOtpIpRateLimit,
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
  windowMs: VERIFY_OTP_PHONE_WINDOW_MS,
  limit: 5,
  store: new PostgresRateLimitStore("otp-verify-phone", VERIFY_OTP_PHONE_WINDOW_MS),
  keyGenerator: getNormalizedOtpPhoneRateLimitKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many verification attempts for this number. Please request a new code." },
});

// ─── POST /api/auth/phone/send-otp ───────────────────────────────────────────

router.post(
  "/auth/phone/send-otp",
  sendOtpIpLimiter,
  sendOtpPhoneLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const [config] = await db.select({ enabled: adminOtpConfigTable.enabled })
      .from(adminOtpConfigTable).limit(1);
    if (config?.enabled === false) {
      res.status(503).json({ error: "Phone OTP is temporarily disabled" });
      return;
    }
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

    try {
      await ensureSmsReady();
    } catch (error) {
      req.log.error({
        stage: "sms_configuration",
        ...smsFailureLogFields(error),
      }, "Phone OTP request cannot proceed because SMS delivery is not configured");
      res.status(503).json({ error: "Phone OTP is temporarily unavailable. Please try again later." });
      return;
    }

    let code: string;
    try {
      code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    } catch (error) {
      req.log.error({
        stage: "otp_generation",
        errorCode: safeFailureCode(error),
      }, "Phone OTP code generation failed");
      res.status(503).json({ error: "Could not prepare a sign-in code. Please try again later." });
      return;
    }

    let recordId: string;
    try {
      const [record] = await db.transaction(async (tx) => {
        await tx.delete(otpCodesTable).where(eq(otpCodesTable.phone, normalized));
        return tx.insert(otpCodesTable).values({
          phone: normalized,
          code: otpDigest(normalized, code),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }).returning({ id: otpCodesTable.id });
      });
      if (!record?.id) throw new Error("otp_record_not_returned");
      recordId = record.id;
    } catch (error) {
      req.log.error({
        stage: "otp_persist",
        errorCode: safeFailureCode(error),
      }, "Generated phone OTP could not be stored");
      res.status(503).json({ error: "Could not prepare a sign-in code. Please try again later." });
      return;
    }

    try {
      await sendOtpSms(normalized, code);
    } catch (error) {
      req.log.error({
        stage: "sms_delivery",
        ...smsFailureLogFields(error),
      }, "Phone OTP SMS delivery failed");
      try {
        await db.delete(otpCodesTable).where(eq(otpCodesTable.id, recordId));
      } catch (cleanupError) {
        req.log.error({
          stage: "otp_cleanup",
          errorCode: safeFailureCode(cleanupError),
        }, "Undelivered phone OTP record could not be removed");
      }
      res.status(503).json({ error: "Could not send the SMS code. Please try again later." });
      return;
    }
    res.json({ success: true });
  },
);

// ─── POST /api/auth/phone/verify-otp ─────────────────────────────────────────

router.post(
  "/auth/phone/verify-otp",
  verifyOtpIpLimiter,
  verifyOtpPhoneLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const [config] = await db.select({ enabled: adminOtpConfigTable.enabled })
      .from(adminOtpConfigTable).limit(1);
    if (config?.enabled === false) {
      res.status(503).json({ error: "Phone OTP is temporarily disabled" });
      return;
    }
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
          eq(otpCodesTable.code, otpDigest(normalized, code.trim())),
          eq(otpCodesTable.verified, false),
          gt(otpCodesTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!record) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    // Consume atomically: two requests with the same code cannot each claim
    // an invitation or create a different account.
    const [consumed] = await db
      .update(otpCodesTable)
      .set({ verified: true })
      .where(and(
        eq(otpCodesTable.id, record.id),
        eq(otpCodesTable.verified, false),
        gt(otpCodesTable.expiresAt, new Date()),
      )).returning({ id: otpCodesTable.id });
    if (!consumed) {
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    // JIT provision the user + business.
    const user = await getOrCreatePhoneUser(normalized);
    if (user.status !== "active" || user.workerAccessDeletedAt) {
      res.status(403).json({ error: user.workerAccessDeletedAt
        ? "Staff access removed. Ask the owner for a new invitation." : "Account suspended" });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(appUsersTable).set({ lastLogin: new Date() })
        .where(eq(appUsersTable.id, user.id));
      await tx.insert(userLoginEventsTable).values({
        userId: user.id, ip: clientIp(req), device: deviceDescription(req),
        authMethod: "phone", source: req.get("x-client-platform") === "mobile" ? "mobile" : "web",
      });
      await tx.delete(userLoginEventsTable).where(lt(userLoginEventsTable.occurredAt,
        new Date(Date.now() - 90 * 24 * 60 * 60_000)));
    });

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
    // Mobile keeps this token in SecureStore; phoneSessionVersion revokes it on logout.
    const token = jwt.sign(sessionPayload, process.env.SESSION_SECRET!);

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
    let payload: { userId?: string; phone?: string; sessionVersion?: number } | null = null;
    try {
      payload = jwt.verify(token, process.env.SESSION_SECRET!, { ignoreExpiration: true }) as {
        userId?: string; phone?: string; sessionVersion?: number;
      };
    } catch {
      // Invalid sessions are already unusable; still clear the browser cookie.
    }
    if (payload?.userId && payload.phone) {
      const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, payload.userId)).limit(1);
      if (user?.phone === payload.phone &&
          user.phoneSessionVersion === payload.sessionVersion) {
        // A DB error must fail the request. The client must keep its credential
        // and retry rather than claiming the copied token was revoked.
        await db.update(appUsersTable)
          .set({ phoneSessionVersion: user.phoneSessionVersion + 1, lastLogout: new Date() })
          .where(eq(appUsersTable.id, user.id));
        await db.delete(userPresenceTable).where(eq(userPresenceTable.userId, user.id));
      }
    }
  }
  clearPhoneSession(res);
  res.json({ success: true });
});

// Called only by an explicit user-initiated sign-out action. Session expiry and
// ordinary auth failures must never update lastLogout.
router.post("/auth/logout-event", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const auth = req as AuthenticatedRequest;
  await db.transaction(async (tx) => {
    if (auth.authMethod === "clerk") {
      if (!auth.clerkSessionId) throw new Error("Missing Clerk session to revoke");
      await tx.update(appUserLoginSessionsTable).set({ revokedAt: new Date() }).where(and(
        eq(appUserLoginSessionsTable.userId, auth.userId),
        eq(appUserLoginSessionsTable.sessionId, auth.clerkSessionId),
      ));
    }
    await tx.delete(userPresenceTable).where(auth.authMethod === "clerk"
      ? and(eq(userPresenceTable.userId, auth.userId),
        eq(userPresenceTable.sessionId, `clerk:${auth.clerkSessionId}`))
      : eq(userPresenceTable.userId, auth.userId));
    await tx.update(appUsersTable).set({ lastLogout: new Date() }).where(and(
      eq(appUsersTable.id, auth.userId),
      eq(appUsersTable.businessId, auth.businessId),
    ));
  });
  if (auth.authMethod === "clerk") clearClerkWebViewSession(res);
  res.status(204).end();
});

// Called only while the app is foregrounded, never by an admin list view or
// background fetch. Refreshes existing presence without generating login events.
router.post("/auth/presence", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const auth = req as AuthenticatedRequest;
  if (auth.authMethod === "dev") { res.status(204).end(); return; }
  const sessionId = auth.authMethod === "clerk"
    ? `clerk:${auth.clerkSessionId}`
    : `phone:${(await db.select({ version: appUsersTable.phoneSessionVersion })
      .from(appUsersTable).where(eq(appUsersTable.id, auth.userId)).limit(1))[0]?.version}`;
  await db.insert(userPresenceTable).values({
    userId: auth.userId, sessionId, lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [userPresenceTable.userId, userPresenceTable.sessionId],
    set: { lastSeenAt: new Date() },
  });
  await db.delete(userPresenceTable).where(lt(userPresenceTable.lastSeenAt,
    new Date(Date.now() - 24 * 60 * 60_000)));
  res.status(204).end();
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get(
  "/auth/me",
  (_req, res, next) => {
    // This identity response is user-specific and is also the frontend's
    // initial connectivity probe. Do not let browser/CDN caches revalidate it
    // into a body-less 304 that the probe can mistake for an offline server.
    res.setHeader("Cache-Control", "private, no-store");
    next();
  },
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    const [business] = await db.select({ name: businessesTable.name }).from(businessesTable)
      .where(eq(businessesTable.id, auth.businessId)).limit(1);
    const [user] = await db.select({
      ids: appUsersTable.adjustmentPartyIds,
      clerkUserId: appUsersTable.clerkUserId,
      phone: appUsersTable.phone,
      phoneSessionVersion: appUsersTable.phoneSessionVersion,
    }).from(appUsersTable)
      .where(eq(appUsersTable.id, auth.userId)).limit(1);
    if (isNativeWebViewSessionExchange(req)) {
      if (auth.authMethod === "clerk" && auth.clerkSessionId && user?.clerkUserId) {
        clearPhoneSession(res);
        issueClerkWebViewSession(res, {
          userId: auth.userId,
          clerkUserId: user.clerkUserId,
          sessionId: auth.clerkSessionId,
        });
      } else if (
        auth.authMethod === "phone"
        && user?.phone
        && Number.isInteger(user.phoneSessionVersion)
      ) {
        clearClerkWebViewSession(res);
        issuePhoneSession(res, {
          userId: auth.userId,
          businessId: auth.businessId,
          phone: user.phone,
          sessionVersion: user.phoneSessionVersion,
        });
      }
    }
    const targets = auth.role === "staff" && user?.ids.length
      ? await db.select({ id: partiesTable.id }).from(partiesTable)
        .where(and(eq(partiesTable.businessId, auth.businessId), inArray(partiesTable.id, user.ids)))
      : [];
    res.json({
      role: auth.role,
      businessId: auth.businessId,
      userId: auth.userId,
      businessName: business?.name ?? "",
      authMethod: auth.authMethod,
      adjustmentPartyIds: auth.role === "staff" ? targets.map((party) => party.id) : [],
      ...(auth.phone ? { phone: auth.phone } : {}),
    });
  },
);

export default router;
