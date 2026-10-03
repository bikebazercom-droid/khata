import type { LedgerRecord, PartyRecord } from '@/lib/domain';
import {
  formatLocalTime,
  getLedgerEntryDateKey,
  getLocalDateKey,
} from '@workspace/api-client-react/ledger-domain';

export { getLedgerEntryDateKey };

export type PartyLedgerBalance = Pick<PartyRecord, 'currentBalance' | 'balanceType'>;
export type PartyLedgerEntry = LedgerRecord & { businessDate: string; balanceAfter: number };
export type PartyLedgerDayGroup<T> = { dayKey: string; entries: T[] };
type PartyLedgerSource = Pick<LedgerRecord, 'id' | 'type' | 'amount' | 'createdAt' | 'dueDate'>;

export function buildPartyLedgerTimeline<T extends PartyLedgerSource>(
  entries: readonly T[],
  party: PartyLedgerBalance,
): Array<T & { businessDate: string; balanceAfter: number }> {
  const originalOrder = new Map(entries.map((entry, index) => [entry.id, index]));
  const signedDelta = (entry: PartyLedgerSource) => entry.type === 'YOU_GAVE' ? entry.amount : -entry.amount;
  const totalDelta = entries.reduce((sum, entry) => sum + signedDelta(entry), 0);
  let balance = (party.balanceType === 'YOU_WILL_GET' ? party.currentBalance : -party.currentBalance) - totalDelta;

  const chronological = [...entries].sort((left, right) => {
    const leftDate = getLedgerEntryDateKey(left.dueDate, left.createdAt);
    const rightDate = getLedgerEntryDateKey(right.dueDate, right.createdAt);
    const dateOrder = leftDate.localeCompare(rightDate);
    if (dateOrder !== 0) return dateOrder;
    const timeOrder = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return timeOrder || (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
  });

  return chronological.map((entry) => {
    balance += signedDelta(entry);
    return {
      ...entry,
      businessDate: getLedgerEntryDateKey(entry.dueDate, entry.createdAt),
      balanceAfter: balance,
    };
  });
}

export function groupPartyLedgerByDay<T extends { businessDate: string }>(
  newestFirstEntries: readonly T[],
): PartyLedgerDayGroup<T>[] {
  const groups: PartyLedgerDayGroup<T>[] = [];
  for (const entry of newestFirstEntries) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.dayKey === entry.businessDate) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ dayKey: entry.businessDate, entries: [entry] });
    }
  }
  return groups;
}

export function formatPartyLedgerDay(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
    : dayKey;
}

export function formatPartyLedgerEntryTime(createdAt: string | Date): string {
  return formatLocalTime(createdAt);
}

export function getLocalTodayDateKey(now = new Date()): string {
  return getLocalDateKey(now);
}