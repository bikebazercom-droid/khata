import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { formatLedgerEntryDateTime, getLedgerEntryDateKey } from './date-time';

export interface PartyStatementEntry {
  id: string;
  type: 'YOU_GAVE' | 'YOU_GOT';
  amount: number;
  createdAt: string | Date;
  dueDate?: string | null;
  description?: string | null;
  billReference?: string | null;
}

export interface PartyStatementSummary {
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

export interface PartyStatementRow {
  id: string;
  dayKey: string;
  dayLabel: string;
  dateTime: string;
  details: string;
  debit: number | null;
  credit: number | null;
  balanceAfter: number;
}

type BalanceType = 'YOU_WILL_GET' | 'YOU_WILL_GIVE';

export function resolvePartyStatementDateRange(
  selectedRange: { start: Date; end: Date } | null,
  entries: readonly PartyStatementEntry[],
): { start: Date; end: Date } | null {
  if (selectedRange) return selectedRange;
  if (entries.length === 0) return null;

  const dateKeys = entries
    .map((entry) => getLedgerEntryDateKey(entry.dueDate, entry.createdAt))
    .sort();
  const toLocalDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year!, month! - 1, day!);
  };

  return {
    start: toLocalDate(dateKeys[0]!),
    end: toLocalDate(dateKeys[dateKeys.length - 1]!),
  };
}

function signedDelta(entry: PartyStatementEntry): number {
  return entry.type === 'YOU_GAVE' ? entry.amount : -entry.amount;
}

export function filterPartyStatementEntriesByRange<T extends PartyStatementEntry>(
  entries: readonly T[],
  range: { start: Date; end: Date } | null,
): T[] {
  if (!range) return [...entries];

  const startDayKey = getLedgerEntryDateKey(null, range.start);
  const endDayKey = getLedgerEntryDateKey(null, range.end);

  return entries.filter((entry) => {
    const entryDayKey = getLedgerEntryDateKey(entry.dueDate, entry.createdAt);
    return entryDayKey >= startDayKey && entryDayKey <= endDayKey;
  });
}

export function calculatePartyStatementSummary({
  allEntries,
  statementEntries,
  currentBalance,
  balanceType,
  periodStart,
}: {
  allEntries: readonly PartyStatementEntry[];
  statementEntries: readonly PartyStatementEntry[];
  currentBalance: number;
  balanceType: BalanceType;
  periodStart: Date | null;
}): PartyStatementSummary {
  const signedCurrentBalance = balanceType === 'YOU_WILL_GET' ? currentBalance : -currentBalance;
  const openingBeforeAllEntries = signedCurrentBalance - allEntries.reduce((sum, entry) => sum + signedDelta(entry), 0);
  const periodStartDayKey = periodStart ? getLedgerEntryDateKey(null, periodStart) : null;
  const openingBalance = openingBeforeAllEntries + (periodStartDayKey
    ? allEntries
      .filter((entry) => getLedgerEntryDateKey(entry.dueDate, entry.createdAt) < periodStartDayKey)
      .reduce((sum, entry) => sum + signedDelta(entry), 0)
    : 0);

  const totalDebit = statementEntries.reduce(
    (sum, entry) => sum + (entry.type === 'YOU_GAVE' ? entry.amount : 0),
    0,
  );
  const totalCredit = statementEntries.reduce(
    (sum, entry) => sum + (entry.type === 'YOU_GOT' ? entry.amount : 0),
    0,
  );

  return {
    openingBalance,
    totalDebit,
    totalCredit,
    closingBalance: openingBalance + totalDebit - totalCredit,
  };
}

export function buildPartyStatementRows(
  entries: readonly PartyStatementEntry[],
  openingBalance: number,
): PartyStatementRow[] {
  const chronologicalEntries = entries
    .map((entry, index) => ({
      entry,
      index,
      dayKey: getLedgerEntryDateKey(entry.dueDate, entry.createdAt),
    }))
    .sort((a, b) =>
      a.dayKey.localeCompare(b.dayKey) ||
      new Date(a.entry.createdAt).getTime() - new Date(b.entry.createdAt).getTime() ||
      a.index - b.index,
    );

  let balance = openingBalance;
  const chronologicalRows = chronologicalEntries.map(({ entry, dayKey }) => {
    const isDebit = entry.type === 'YOU_GAVE';
    balance += signedDelta(entry);
    const date = new Date(`${dayKey}T00:00:00`);
    const description = entry.description?.trim() || (isDebit ? 'নগদ প্রদান' : 'নগদ গ্রহণ');
    const details = entry.billReference
      ? `${description} (বিল: ${entry.billReference})`
      : description;

    return {
      id: entry.id,
      dayKey,
      dayLabel: format(date, 'd MMMM yyyy', { locale: bn }),
      dateTime: formatLedgerEntryDateTime(entry.dueDate, entry.createdAt),
      details,
      debit: isDebit ? entry.amount : null,
      credit: isDebit ? null : entry.amount,
      balanceAfter: balance,
    };
  });

  // Keep the statement oldest-to-newest so dates and balances read forward.
  return chronologicalRows;
}