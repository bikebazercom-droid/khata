import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { clientIp } from "../middlewares/ipBlock";
import { normalizeBdPhone } from "./bdPhone";

/**
 * Return a rate-limit key only when the configured IP policy resolved a
 * verified client. Never fall back to the shared proxy socket or X-Forwarded-For.
 */
export function getVerifiedOtpIpRateLimitKey(req: Request): string | null {
  const ip = clientIp(req);
  return ip ? ipKeyGenerator(ip) : null;
}

export function shouldSkipOtpIpRateLimit(req: Request): boolean {
  return getVerifiedOtpIpRateLimitKey(req) === null;
}

export function getNormalizedOtpPhoneRateLimitKey(req: Request): string {
  const raw = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  return `phone:${(raw && normalizeBdPhone(raw)) || "invalid"}`;
}