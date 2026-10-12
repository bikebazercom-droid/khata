import { format } from 'date-fns';
import { bn, enUS } from 'date-fns/locale';
import {
  formatLocalTime,
  getLedgerEntryDateKey,
} from '@workspace/api-client-react/ledger-domain';

export { formatLocalTime, getLedgerEntryDateKey };

/** Date-only label for printable statements; it deliberately omits creation time. */
export function formatLedgerEntryDate(
  dueDate: string | null | undefined,
  createdAt: string | Date,
  lang: 'bn' | 'en' = 'bn',
): string {
  const dateKey = getLedgerEntryDateKey(dueDate, createdAt);
  const [year, month, day] = dateKey.split('-').map(Number);
  return format(new Date(year, month - 1, day), 'd MMMM yy', { locale: lang === 'en' ? enUS : bn });
}

/**
/** Matches the party history row: business date plus local 12-hour creation time. */
export function formatLedgerEntryDateTime(
  dueDate: string | null | undefined,
  createdAt: string | Date,
  lang: 'bn' | 'en' = 'bn',
): string {
  const dateKey = getLedgerEntryDateKey(dueDate, createdAt);
  const [year, month, day] = dateKey.split('-').map(Number);
  const businessDate = new Date(year, month - 1, day);
  const time = lang === 'en'
    ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(createdAt))
    : formatLocalTime(createdAt);
  return `${format(businessDate, 'd MMM yy', { locale: lang === 'en' ? enUS : bn })} • ${time}`;
}