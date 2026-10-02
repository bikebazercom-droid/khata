import { format } from 'date-fns';
import { bn } from 'date-fns/locale';

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

/**
 * Returns the transaction's business date without timezone-shifting date-only
 * values. `dueDate` may be serialized as either yyyy-MM-dd or an ISO string.
 */
export function getLedgerEntryDateKey(
  dueDate: string | null | undefined,
  createdAt: string | Date,
): string {
  if (dueDate) {
    const datePart = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(dueDate);
    if (!datePart) {
      throw new RangeError(`Invalid ledger entry date: ${dueDate}`);
    }

    const [, year, month, day] = datePart;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (
      localDate.getFullYear() !== Number(year) ||
      localDate.getMonth() !== Number(month) - 1 ||
      localDate.getDate() !== Number(day)
    ) {
      throw new RangeError(`Invalid ledger entry date: ${dueDate}`);
    }

    return `${year}-${month}-${day}`;
  }

  const creationDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return format(creationDate, 'yyyy-MM-dd');
}

/** Matches the party history row: business date plus local 12-hour creation time. */
export function formatLedgerEntryDateTime(
  dueDate: string | null | undefined,
  createdAt: string | Date,
): string {
  const dateKey = getLedgerEntryDateKey(dueDate, createdAt);
  const [year, month, day] = dateKey.split('-').map(Number);
  const businessDate = new Date(year, month - 1, day);
  return `${format(businessDate, 'd MMM yy', { locale: bn })} • ${formatLocalTime(createdAt)}`;
}