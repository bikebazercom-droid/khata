/**
 * Formats a transaction's creation time in the viewer's local timezone.
 * The default is the 24-hour style used in the party ledger.
 */
export function formatLocalTime(value: string | Date, hour12 = false): string {
  const date = value instanceof Date ? value : new Date(value);
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' }),
  };

  return new Intl.DateTimeFormat(hour12 ? 'en-US' : 'en-GB', options).format(date);
}