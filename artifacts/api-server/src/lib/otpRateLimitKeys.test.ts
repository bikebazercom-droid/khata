import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  getNormalizedOtpPhoneRateLimitKey,
  getVerifiedOtpIpRateLimitKey,
  shouldSkipOtpIpRateLimit,
} from "./otpRateLimitKeys";

const previousClientIpMode = process.env.CLIENT_IP_MODE;
const previousTrustedProxyCidrs = process.env.TRUSTED_PROXY_CIDRS;

function makeRequest(
  ip: string,
  ips: string[] = [],
  xForwardedFor = "198.51.100.99",
): Request {
  return {
    ip,
    ips,
    headers: { "x-forwarded-for": xForwardedFor },
    body: {},
  } as unknown as Request;
}

afterEach(() => {
  if (previousClientIpMode === undefined) delete process.env.CLIENT_IP_MODE;
  else process.env.CLIENT_IP_MODE = previousClientIpMode;
  if (previousTrustedProxyCidrs === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
  else process.env.TRUSTED_PROXY_CIDRS = previousTrustedProxyCidrs;
});

describe("OTP rate-limit keys", () => {
  it("does not treat an unconfigured socket peer or forwarded header as a client IP", () => {
    delete process.env.CLIENT_IP_MODE;
    delete process.env.TRUSTED_PROXY_CIDRS;

    const req = makeRequest("127.0.0.1", [], "203.0.113.10");
    expect(getVerifiedOtpIpRateLimitKey(req)).toBeNull();
    expect(shouldSkipOtpIpRateLimit(req)).toBe(true);
  });

  it("uses the direct peer and ignores spoofed forwarding headers in direct mode", () => {
    process.env.CLIENT_IP_MODE = "direct";
    delete process.env.TRUSTED_PROXY_CIDRS;

    const req = makeRequest("203.0.113.25", [], "198.51.100.99");
    expect(getVerifiedOtpIpRateLimitKey(req)).toBe("203.0.113.25");
    expect(shouldSkipOtpIpRateLimit(req)).toBe(false);
  });

  it("uses Express's resolved forwarded client only under trusted-proxy policy", () => {
    delete process.env.CLIENT_IP_MODE;
    process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/8";

    const verified = makeRequest("203.0.113.25", ["203.0.113.25"], "198.51.100.99");
    const unresolved = makeRequest("127.0.0.1", [], "203.0.113.25");

    expect(getVerifiedOtpIpRateLimitKey(verified)).toBe("203.0.113.25");
    expect(getVerifiedOtpIpRateLimitKey(unresolved)).toBeNull();
    expect(shouldSkipOtpIpRateLimit(unresolved)).toBe(true);
  });

  it("normalizes equivalent Bangladesh phone formats into the same bucket", () => {
    const local = { body: { phone: "01712345678" } } as Request;
    const international = { body: { phone: "+8801712345678" } } as Request;
    const bengaliDigits = { body: { phone: "০১৭১২৩৪৫৬৭৮" } } as Request;

    expect(getNormalizedOtpPhoneRateLimitKey(local)).toBe("phone:+8801712345678");
    expect(getNormalizedOtpPhoneRateLimitKey(international)).toBe("phone:+8801712345678");
    expect(getNormalizedOtpPhoneRateLimitKey(bengaliDigits)).toBe("phone:+8801712345678");
  });

  it("uses one bounded phone bucket for malformed phone input", () => {
    expect(getNormalizedOtpPhoneRateLimitKey({ body: { phone: "not-a-phone" } } as Request))
      .toBe("phone:invalid");
    expect(getNormalizedOtpPhoneRateLimitKey({ body: {} } as Request)).toBe("phone:invalid");
  });
});