import { describe, expect, it } from "vitest";
import { normalizeOtpCode, OTP_VALIDITY_MINUTES, OTP_VALIDITY_MS } from "./otp";

describe("OTP normalization and validity", () => {
  it.each([
    ["012345", "012345"],
    [" 012345 ", "012345"],
    ["০১২৩৪৫", "012345"],
    ["০১২-৩৪৫", "012345"],
  ])("normalizes submitted code %s", (input, expected) => {
    expect(normalizeOtpCode(input)).toBe(expected);
  });

  it.each(["12345", "1234567", "12a345", "１２３４５６", ""])(
    "rejects malformed OTP %s",
    (input) => {
      expect(normalizeOtpCode(input)).toBeNull();
    },
  );

  it("keeps the configured validity window in sync in milliseconds", () => {
    expect(OTP_VALIDITY_MINUTES).toBe(15);
    expect(OTP_VALIDITY_MS).toBe(15 * 60 * 1000);
  });
});
