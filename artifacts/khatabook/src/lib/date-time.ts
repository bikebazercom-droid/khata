/**
 * Formats a transaction's creation time in the viewer's local timezone.
 * Uses a consistent 12-hour clock with AM/PM across transaction views.
 */
export function formatLocalTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}