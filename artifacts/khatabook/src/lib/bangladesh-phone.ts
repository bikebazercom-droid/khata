function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Shows imported +880 numbers in the local mobile-number format used by the
 * form, while leaving a locally entered 01… number unchanged.
 */
export function formatBangladeshPhoneForInput(value: string): string {
  const digits = digitsOnly(value);
  if (digits.startsWith('880')) return `0${digits.slice(3)}`;
  return digits;
}

/**
 * Converts local Bangladesh numbers to E.164. Empty input remains optional;
 * the API supplies its existing empty-string default for the database column.
 */
export function normalizeBangladeshPhone(value: string): string | undefined {
  let digits = digitsOnly(value);
  if (digits.startsWith('880')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits ? `+880${digits}` : undefined;
}
