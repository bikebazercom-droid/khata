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
  userLoginEventsTable,
  userPresenceTable,
  adminOtpConfigTable,
  businessesTable,
  workerPartyAssignmentsTable,
  partiesTable,
} from "@workspace/db";
import {
  PreapprovalRequiredError,
  clearFirebaseSession,
  getOrCreatePhoneUser,
  getOrCreateFirebaseUser,
  issuePhoneSession,
  issueFirebaseSession,
  clearPhoneSession,
  isNativeWebViewSessionExchange,
  requireAuth,
  type AuthenticatedRequest,
} from "../middlewares/requireAuth";
import { ensureSmsReady, sendOtpSms, SmsGatewayError } from "../services/sms";
import { clientIp } from "../middlewares/ipBlock";
import { deviceDescription, recordFailedLoginAttempt } from "../lib/authTelemetry";
import { normalizeBdPhone } from "../lib/bdPhone";
import { normalizeOtpCode, OTP_VALIDITY_MS } from "../lib/otp";
import { verifyFirebaseIdToken } from "../lib/firebaseAuth";
import { PostgresRateLimitStore } from "../lib/postgresRateLimitStore";
import {
  getNormalizedOtpPhoneRateLimitKey,
  getVerifiedOtpIpRateLimitKey,
  shouldSkipOtpIpRateLimit,
} from "../lib/otpRateLimitKeys";

const router: IRouter = Router();

router.post("/auth/firebase/session", rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
}), async (req: Request, res: Response): Promise<void> => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
  if (!idToken || idToken.length > 10_000) {
    res.status(400).json({ error: "A valid Firebase ID token is required" });
    return;
  }

  let identity;
  try {
    identity = await verifyFirebaseIdToken(idToken);
  } catch (error) {
    req.log?.error({ err: error }, "Firebase token verification unavailable");
    res.status(503).json({ error: "Google sign-in verification is temporarily unavailable" });
    return;
  }
  if (!identity) {
    res.status(401).json({ error: "Firebase identity is invalid or its email is not verified" });
    return;
  }

  try {
    const user = await getOrCreateFirebaseUser(identity.uid, identity.email, identity.displayName);
    if (user.workerAccessDeletedAt || user.status !== "active") {
      res.status(403).json({ error: "Account suspended or access removed" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(appUsersTable).set({ lastLogin: new Date() })
        .where(eq(appUsersTable.id, user.id));
      await tx.insert(userLoginEventsTable).values({
        userId: user.id,
        ip: clientIp(req),
        device: deviceDescription(req),
        authMethod: "firebase",
        source: req.get("x-client-platform") === "mobile" ? "mobile" : "web",
      });
    });
    issueFirebaseSession(res, {
      userId: user.id,
      businessId: user.businessId,
      firebaseUid: identity.uid,
      sessionVersion: user.phoneSessionVersion,
    });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof PreapprovalRequiredError) {
      res.status(403).json({ error: "This email is not approved for BanglaKhata access" });
      return;
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("matches multiple accounts") || message.includes("already linked")) {
      res.status(409).json({ error: message });
      return;
    }
    throw error;
  }
});

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
  handler: (req, res) => {
    void recordFailedLoginAttempt(req, {
      identifier: typeof req.body?.phone === "string" ? normalizeBdPhone(req.body.phone) ?? "invalid_phone" : "unknown",
      authMethod: "phone", stage: "send_otp", errorCode: "rate_limited_ip",
    });
    res.status(429).json({ error: "Too many OTP requests from this IP. Please wait 15 minutes before trying again." });
  },
});

const sendOtpPhoneLimiter = rateLimit({
  windowMs: SEND_OTP_PHONE_WINDOW_MS,
  limit: 3,
  store: new PostgresRateLimitStore("otp-send-phone", SEND_OTP_PHONE_WINDOW_MS),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: getNormalizedOtpPhoneRateLimitKey,
  message: { error: "Too many codes requested for this phone. Please try again later." },
  handler: (req, res) => {
    void recordFailedLoginAttempt(req, {
      identifier: typeof req.body?.phone === "string" ? normalizeBdPhone(req.body.phone) ?? "invalid_phone" : "unknown",
      authMethod: "phone", stage: "send_otp", errorCode: "rate_limited_phone",
    });
    res.status(429).json({ error: "Too many codes requested for this phone. Please try again later." });
  },
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
  handler: (req, res) => {
    void recordFailedLoginAttempt(req, {
      identifier: typeof req.body?.phone === "string" ? normalizeBdPhone(req.body.phone) ?? "invalid_phone" : "unknown",
      authMethod: "phone", stage: "verify_otp", errorCode: "rate_limited_ip",
    });
    res.status(429).json({ error: "Too many verification attempts from this IP. Please wait 15 minutes." });
  },
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
  handler: (req, res) => {
    void recordFailedLoginAttempt(req, {
      identifier: typeof req.body?.phone === "string" ? normalizeBdPhone(req.body.phone) ?? "invalid_phone" : "unknown",
      authMethod: "phone", stage: "verify_otp", errorCode: "rate_limited_phone",
    });
    res.status(429).json({ error: "Too many verification attempts for this number. Please request a new code." });
  },
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
      await recordFailedLoginAttempt(req, {
        identifier: typeof req.body?.phone === "string" ? normalizeBdPhone(req.body.phone) ?? "invalid_phone" : "unknown",
        authMethod: "phone", stage: "send_otp", errorCode: "otp_disabled",
      });
      res.status(503).json({ error: "Phone OTP is temporarily disabled" });
      return;
    }
    const { phone } = req.body ?? {};
    if (typeof phone !== "string" || !phone.trim()) {
      await recordFailedLoginAttempt(req, {
        identifier: "unknown", authMethod: "phone", stage: "send_otp", errorCode: "missing_phone",
      });
      res.status(400).json({ error: "phone is required" });
      return;
    }

    const normalized = normalizeBdPhone(phone.trim());
    if (!normalized) {
      await recordFailedLoginAttempt(req, {
        identifier: phone.trim(), authMethod: "phone", stage: "send_otp", errorCode: "invalid_phone",
      });
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
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "send_otp", errorCode: safeFailureCode(error),
      });
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
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "send_otp", errorCode: safeFailureCode(error),
      });
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
          expiresAt: new Date(Date.now() + OTP_VALIDITY_MS),
        }).returning({ id: otpCodesTable.id });
      });
      if (!record?.id) throw new Error("otp_record_not_returned");
      recordId = record.id;
    } catch (error) {
      req.log.error({
        stage: "otp_persist",
        errorCode: safeFailureCode(error),
      }, "Generated phone OTP could not be stored");
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "send_otp", errorCode: safeFailureCode(error),
      });
      res.status(503).json({ error: "Could not prepare a sign-in code. Please try again later." });
      return;
    }

    try {
      const receipt = await sendOtpSms(normalized, code);
      req.log.info({
        stage: "sms_delivery",
        providerStatus: "accepted",
        ...(receipt?.providerRequestId !== undefined
          ? { providerRequestId: receipt.providerRequestId }
          : {}),
      }, "Phone OTP SMS accepted by provider");
    } catch (error) {
      req.log.error({
        stage: "sms_delivery",
        ...smsFailureLogFields(error),
      }, "Phone OTP SMS delivery failed");
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "send_otp", errorCode: safeFailureCode(error),
      });
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
      await recordFailedLoginAttempt(req, {
        identifier: typeof req.body?.phone === "string" ? normalizeBdPhone(req.body.phone) ?? "invalid_phone" : "unknown",
        authMethod: "phone", stage: "verify_otp", errorCode: "otp_disabled",
      });
      res.status(503).json({ error: "Phone OTP is temporarily disabled" });
      return;
    }
    const { phone, code } = req.body ?? {};
    if (typeof phone !== "string" || typeof code !== "string") {
      await recordFailedLoginAttempt(req, {
        identifier: typeof phone === "string" ? normalizeBdPhone(phone) ?? phone : "unknown",
        authMethod: "phone", stage: "verify_otp", errorCode: "missing_phone_or_code",
      });
      res.status(400).json({ error: "phone and code are required" });
      return;
    }

    const normalized = normalizeBdPhone(phone.trim());
    if (!normalized) {
      await recordFailedLoginAttempt(req, {
        identifier: phone.trim(), authMethod: "phone", stage: "verify_otp", errorCode: "invalid_phone",
      });
      res.status(400).json({ error: "Invalid phone number" });
      return;
    }

    const normalizedCode = normalizeOtpCode(code);
    if (!normalizedCode) {
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "verify_otp", errorCode: "invalid_code_format",
      });
      res.status(400).json({ error: "Enter the 6-digit code from the SMS" });
      return;
    }

    const [record] = await db
      .select({ id: otpCodesTable.id })
      .from(otpCodesTable)
      .where(
        and(
          eq(otpCodesTable.phone, normalized),
          eq(otpCodesTable.code, otpDigest(normalized, normalizedCode)),
          gt(otpCodesTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!record) {
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "verify_otp", errorCode: "invalid_or_expired_code",
      });
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    // Delete atomically so replay is impossible without relying on the
    // optional `verified` column that may be absent in older production DBs.
    const [consumed] = await db
      .delete(otpCodesTable)
      .where(and(
        eq(otpCodesTable.id, record.id),
        gt(otpCodesTable.expiresAt, new Date()),
      )).returning({ id: otpCodesTable.id });
    if (!consumed) {
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "verify_otp", errorCode: "invalid_or_expired_code",
      });
      res.status(401).json({ error: "Invalid or expired code" });
      return;
    }

    // JIT provision the user + business.
    let user;
    try {
      user = await getOrCreatePhoneUser(normalized);
    } catch (error) {
      if (error instanceof Error && error.name === "PreapprovalRequiredError") {
        await recordFailedLoginAttempt(req, {
          identifier: normalized, authMethod: "phone", stage: "account_creation", errorCode: "not_preapproved",
        });
        res.status(403).json({ error: "Account creation is currently limited to pre-approved phone numbers" });
        return;
      }
      throw error;
    }
    if (user.workerAccessDeletedAt) {
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "account_status",
        errorCode: "staff_access_revoked",
      });
      clearPhoneSession(res);
      res.status(403).json({
        error: "Staff access removed. Ask the owner for a new invitation.",
        code: "STAFF_ACCESS_REVOKED",
      });
      return;
    }
    if (user.status !== "active") {
      await recordFailedLoginAttempt(req, {
        identifier: normalized, authMethod: "phone", stage: "account_status",
        errorCode: "account_suspended",
      });
      res.status(403).json({ error: "Account suspended", code: "ACCOUNT_SUSPENDED" });
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
    const [business] = await db.select({ name: businessesTable.name })
      .from(businessesTable)
      .where(eq(businessesTable.id, user.businessId))
      .limit(1);

    res.json({
      success: true,
      userId: user.id,
      businessId: user.businessId,
      phone: normalized,
      token,
      role: user.role,
      authMethod: "phone",
      businessName: business?.name ?? "",
      needsBookName: user.role === "owner" && !business?.name.trim(),
    });
  },
);

// ─── Authenticated owner phone linking ────────────────────────────────────────
// A Firebase Google account owner can add a verified phone to the existing BanglaKhata
// account without creating a second owner or moving any ledger data.

router.post(
  "/auth/phone/link/send-otp",
  requireAuth,
  sendOtpIpLimiter,
  sendOtpPhoneLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    if (auth.role !== "owner") {
      res.status(403).json({ error: "Only the owner can link a phone number." });
      return;
    }
    const { phone } = req.body ?? {};
    const normalized = typeof phone === "string" ? normalizeBdPhone(phone.trim()) : null;
    if (!normalized) {
      res.status(400).json({ error: "Enter a valid Bangladeshi mobile number." });
      return;
    }
    const [linkedUser] = await db.select({ id: appUsersTable.id })
      .from(appUsersTable).where(eq(appUsersTable.phone, normalized)).limit(1);
    if (linkedUser && linkedUser.id !== auth.userId) {
      res.status(409).json({ error: "This phone number is already linked to another account." });
      return;
    }
    const [config] = await db.select({ enabled: adminOtpConfigTable.enabled })
      .from(adminOtpConfigTable).limit(1);
    if (config?.enabled === false) {
      res.status(503).json({ error: "Phone verification is temporarily disabled." });
      return;
    }
    try {
      await ensureSmsReady();
    } catch {
      res.status(503).json({ error: "Phone verification is temporarily unavailable." });
      return;
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    let recordId: string;
    try {
      const [record] = await db.transaction(async (tx) => {
        await tx.delete(otpCodesTable).where(eq(otpCodesTable.phone, normalized));
        return tx.insert(otpCodesTable).values({
          phone: normalized,
          code: otpDigest(normalized, code),
          expiresAt: new Date(Date.now() + OTP_VALIDITY_MS),
        }).returning({ id: otpCodesTable.id });
      });
      if (!record?.id) throw new Error("otp_record_not_returned");
      recordId = record.id;
    } catch {
      res.status(503).json({ error: "Could not prepare a verification code." });
      return;
    }
    try {
      await sendOtpSms(normalized, code);
    } catch {
      await db.delete(otpCodesTable).where(eq(otpCodesTable.id, recordId)).catch((error) => {
        req.log.error({ errorCode: safeFailureCode(error) }, "Undelivered phone-link OTP cleanup failed");
      });
      res.status(503).json({ error: "Could not send the verification SMS." });
      return;
    }
    res.json({ success: true });
  },
);

router.post(
  "/auth/phone/link/verify-otp",
  requireAuth,
  verifyOtpIpLimiter,
  verifyOtpPhoneLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req as AuthenticatedRequest;
    if (auth.role !== "owner") {
      res.status(403).json({ error: "Only the owner can link a phone number." });
      return;
    }
    const { phone, code } = req.body ?? {};
    const normalized = typeof phone === "string" ? normalizeBdPhone(phone.trim()) : null;
    const normalizedCode = typeof code === "string" ? normalizeOtpCode(code) : null;
    if (!normalized) {
      res.status(400).json({ error: "Enter a valid Bangladeshi mobile number." });
      return;
    }
    if (!normalizedCode) {
      res.status(400).json({ error: "Enter the 6-digit code from the SMS." });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [otp] = await tx.select({ id: otpCodesTable.id })
          .from(otpCodesTable)
          .where(and(
            eq(otpCodesTable.phone, normalized),
            eq(otpCodesTable.code, otpDigest(normalized, normalizedCode)),
            gt(otpCodesTable.expiresAt, new Date()),
          ))
          .limit(1)
          .for("update");
        if (!otp) return "invalid" as const;

        const [linkedUser] = await tx.select({ id: appUsersTable.id })
          .from(appUsersTable).where(eq(appUsersTable.phone, normalized)).limit(1);
        if (linkedUser && linkedUser.id !== auth.userId) return "phone_in_use" as const;

        const [updated] = await tx.update(appUsersTable)
          .set({ phone: normalized })
          .where(eq(appUsersTable.id, auth.userId))
          .returning({ id: appUsersTable.id });
        if (!updated) return "account_missing" as const;

        const [consumed] = await tx.delete(otpCodesTable)
          .where(and(eq(otpCodesTable.id, otp.id), gt(otpCodesTable.expiresAt, new Date())))
          .returning({ id: otpCodesTable.id });
        if (!consumed) return "invalid" as const;
        return "linked" as const;
      });

      if (result === "invalid") {
        await recordFailedLoginAttempt(req, {
          identifier: normalized, authMethod: "phone", stage: "link_phone", errorCode: "invalid_or_expired_code",
        });
        res.status(401).json({ error: "Invalid or expired code. Request a new code and try again." });
        return;
      }
      if (result === "phone_in_use") {
        res.status(409).json({ error: "This phone number is already linked to another account." });
        return;
      }
      if (result === "account_missing") {
        res.status(404).json({ error: "Owner account not found." });
        return;
      }
      res.json({ success: true, phone: normalized });
    } catch (error) {
      const databaseCode = (error as { code?: string; cause?: { code?: string } })?.code
        ?? (error as { cause?: { code?: string } })?.cause?.code;
      if (databaseCode === "23505") {
        res.status(409).json({ error: "This phone number is already linked to another account." });
        return;
      }
      req.log.error({ errorCode: safeFailureCode(error) }, "Phone could not be linked to owner account");
      res.status(503).json({ error: "Phone number could not be linked. Please try again." });
    }
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
    await tx.delete(userPresenceTable).where(eq(userPresenceTable.userId, auth.userId));
    if (auth.authMethod === "firebase") {
      const [current] = await tx.select({ phoneSessionVersion: appUsersTable.phoneSessionVersion })
        .from(appUsersTable).where(eq(appUsersTable.id, auth.userId)).limit(1);
      if (current) {
        await tx.update(appUsersTable).set({
          phoneSessionVersion: current.phoneSessionVersion + 1,
        }).where(eq(appUsersTable.id, auth.userId));
      }
    }
    await tx.update(appUsersTable).set({ lastLogout: new Date() }).where(and(
      eq(appUsersTable.id, auth.userId),
      eq(appUsersTable.businessId, auth.businessId),
    ));
  });
  if (auth.authMethod === "firebase") clearFirebaseSession(res);
  if (auth.authMethod === "phone") clearPhoneSession(res);
  res.status(204).end();
});

// Called only while the app is foregrounded, never by an admin list view or
// background fetch. Refreshes existing presence without generating login events.
router.post("/auth/presence", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const auth = req as AuthenticatedRequest;
  if (auth.authMethod === "dev") { res.status(204).end(); return; }
  const sessionId = auth.authMethod === "firebase"
    ? `firebase:${(await db.select({ uid: appUsersTable.firebaseUid })
      .from(appUsersTable).where(eq(appUsersTable.id, auth.userId)).limit(1))[0]?.uid}`
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
      phone: appUsersTable.phone,
      phoneSessionVersion: appUsersTable.phoneSessionVersion,
    }).from(appUsersTable)
      .where(eq(appUsersTable.id, auth.userId)).limit(1);
    if (isNativeWebViewSessionExchange(req)) {
      if (
        auth.authMethod === "phone"
        && user?.phone
        && Number.isInteger(user.phoneSessionVersion)
      ) {
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
      needsBookName: auth.role === "owner" && !business?.name.trim(),
      authMethod: auth.authMethod,
      adjustmentPartyIds: auth.role === "staff" ? targets.map((party) => party.id) : [],
      ...(auth.phone ? { phone: auth.phone } : {}),
    });
  },
);

export default router;
