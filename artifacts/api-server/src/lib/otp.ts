export const OTP_VALIDITY_MINUTES = 15;
export const OTP_VALIDITY_MS = OTP_VALIDITY_MINUTES * 60 * 1000;

/** Accept six-digit OTPs typed with Bengali digits and common visual separators. */
export function normalizeOtpCode(raw: string): string | null {
  const ascii = raw.replace(/[০-৯]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x09e6),
  );
  const compact = ascii.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(compact) ? compact : null;
}
