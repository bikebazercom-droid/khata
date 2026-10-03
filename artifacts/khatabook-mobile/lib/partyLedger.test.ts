import { describe, expect, it } from 'vitest';
import {
  buildPartyLedgerTimeline,
  formatPartyLedgerDay,
  getLedgerEntryDateKey,
  groupPartyLedgerByDay,
} from '@/lib/partyLedger';

const partyBalance = { currentBalance: 150, balanceType: 'YOU_WILL_GET' as const };

const entries = [
  { id: 'today', type: 'YOU_GAVE' as const, amount: 100, dueDate: '2026-10-03', createdAt: '2026-10-03T06:00:00.000Z' },
  { id: 'backdated', type: 'YOU_GOT' as const, amount: 50, dueDate: '2026-10-01', createdAt: '2026-10-03T05:00:00.000Z' },
];

describe('party ledger timeline', () => {
  it('uses the date-only business date before the local creation date', () => {
    expect(getLedgerEntryDateKey('2026-10-01T00:00:00.000Z', '2026-10-03T06:00:00.000Z')).toBe('2026-10-01');
  });

  it('reconstructs running balances in chronological order for backdated entries', () => {
    const timeline = buildPartyLedgerTimeline(entries, partyBalance);
    expect(timeline.map((entry) => entry.id)).toEqual(['backdated', 'today']);
    expect(timeline.map((entry) => entry.balanceAfter)).toEqual([50, 150]);
  });

  it('groups newest-first rows by business date and formats the heading', () => {
    const newestFirst = [...buildPartyLedgerTimeline(entries, partyBalance)].reverse();
    expect(groupPartyLedgerByDay(newestFirst).map((group) => [group.dayKey, group.entries.length])).toEqual([
      ['2026-10-03', 1],
      ['2026-10-01', 1],
    ]);
    expect(formatPartyLedgerDay('2026-10-03')).toBe('3 Oct 26');
  });
});