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

function signedDelta(entry: PartyStatementEntry): number {
  return entry.type === 'YOU_GAVE' ? entry.amount : -entry.amount;
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
  const openingBalance = openingBeforeAllEntries + (periodStart
    ? allEntries
      .filter((entry) => new Date(entry.createdAt).getTime() < periodStart.getTime())
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
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let balance = openingBalance;
  return sorted.map((entry) => {
    const isDebit = entry.type === 'YOU_GAVE';
    balance += signedDelta(entry);
    const dayKey = getLedgerEntryDateKey(entry.dueDate, entry.createdAt);
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
}