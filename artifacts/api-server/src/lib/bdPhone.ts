/** Normalize Bangladesh mobile numbers to E.164; reject all other countries. */
export function normalizeBdPhone(raw: string): string | null {
  const input = raw.trim().replace(/[০-৯]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x09e6),
  );
  if (!/^\+?[0-9\s().-]+$/.test(input)) return null;

  const digits = input.replace(/\D/g, "");
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}