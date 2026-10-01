import { describe, expect, it } from "vitest";
import { normalizeBdPhone } from "./bdPhone";

describe("normalizeBdPhone", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["+880 (17) 1234-5678", "+8801712345678"],
    ["০১৭১২৩৪৫৬৭৮", "+8801712345678"],
  ])("normalizes Bangladesh number %s", (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each([
    "+14155552671",
    "0171234567",
    "01212345678",
    "01012345678",
    "880171234567",
    "phone 01712345678",
    "++8801712345678",
  ])("rejects invalid or non-Bangladeshi input %s", (input) => {
    expect(normalizeBdPhone(input)).toBeNull();
  });
});