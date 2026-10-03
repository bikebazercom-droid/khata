import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import {
  formatLocalTime,
  getLedgerEntryDateKey,
} from '@workspace/api-client-react/ledger-domain';

export { formatLocalTime, getLedgerEntryDateKey };

/**
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