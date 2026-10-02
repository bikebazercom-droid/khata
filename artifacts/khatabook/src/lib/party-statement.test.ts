import { describe, expect, it } from 'vitest';
import {
  buildPartyStatementRows,
  calculatePartyStatementSummary,
  filterPartyStatementEntriesByRange,
  type PartyStatementEntry,
} from './party-statement';
import { formatLocalTime, getLedgerEntryDateKey } from './date-time';

const allEntries: PartyStatementEntry[] = [
  { id: 'opening-movement', type: 'YOU_GAVE', amount: 100, createdAt: '2026-04-30T12:00:00.000Z' },
  { id: 'credit', type: 'YOU_GOT', amount: 40, createdAt: '2026-05-02T12:00:00.000Z', description: 'পুরোনো বাকি পরিশোধ' },
  { id: 'debit', type: 'YOU_GAVE', amount: 20, createdAt: '2026-05-03T12:00:00.000Z', billReference: 'B-17' },
];

describe('party statement calculations', () => {
  it('calculates opening, debit, credit, and closing balances for a date range', () => {
    const statementEntries = allEntries.slice(1);
    const summary = calculatePartyStatementSummary({
      allEntries,
      statementEntries,
      currentBalance: 90,
      balanceType: 'YOU_WILL_GET',
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(summary).toEqual({
      openingBalance: 110,
      totalDebit: 20,
      totalCredit: 40,
      closingBalance: 90,
    });
  });

  it('filters inclusively by business date instead of creation date', () => {
    const entries: PartyStatementEntry[] = [
      {
        id: 'before-range-created-inside',
        type: 'YOU_GAVE',
        amount: 10,
        createdAt: '2025-05-15T12:00:00.000Z',
        dueDate: '2025-04-30',
      },
      {
        id: 'start-boundary-created-later',
        type: 'YOU_GOT',
        amount: 20,
        createdAt: '2026-10-02T12:00:00.000Z',
        dueDate: '2025-05-01',
      },
      {
        id: 'end-boundary-created-earlier',
        type: 'YOU_GAVE',
        amount: 30,
        createdAt: '2025-04-30T12:00:00.000Z',
        dueDate: '2025-05-31',
      },
      {
        id: 'after-range-created-inside',
        type: 'YOU_GOT',
        amount: 40,
        createdAt: '2025-05-31T12:00:00.000Z',
        dueDate: '2025-06-01',
      },
      {
        id: 'creation-date-fallback',
        type: 'YOU_GOT',
        amount: 50,
        createdAt: '2025-05-31T12:00:00.000Z',
      },
    ];

    const dateRange = {
      start: new Date(2025, 4, 1),
      end: new Date(2025, 4, 31),
    };

    expect(filterPartyStatementEntriesByRange(entries, dateRange).map(({ id }) => id)).toEqual([
      'start-boundary-created-later',
      'end-boundary-created-earlier',
      'creation-date-fallback',
    ]);
  });

  it('calculates the opening balance from business dates before the selected range', () => {
    const allEntries: PartyStatementEntry[] = [
      {
        id: 'backdated-before-range',
        type: 'YOU_GAVE',
        amount: 100,
        createdAt: '2025-05-15T12:00:00.000Z',
        dueDate: '2025-04-30',
      },
      {
        id: 'backdated-into-range',
        type: 'YOU_GOT',
        amount: 40,
        createdAt: '2025-04-30T12:00:00.000Z',
        dueDate: '2025-05-01',
      },
      {
        id: 'backdated-after-range',
        type: 'YOU_GAVE',
        amount: 20,
        createdAt: '2025-04-30T12:00:00.000Z',
        dueDate: '2025-06-01',
      },
    ];
    const range = {
      start: new Date(2025, 4, 1),
      end: new Date(2025, 4, 31),
    };
    const statementEntries = filterPartyStatementEntriesByRange(allEntries, range);

    expect(statementEntries.map(({ id }) => id)).toEqual(['backdated-into-range']);
    expect(calculatePartyStatementSummary({
      allEntries,
      statementEntries,
      currentBalance: 80,
      balanceType: 'YOU_WILL_GET',
      periodStart: range.start,
    })).toEqual({
      openingBalance: 100,
      totalDebit: 0,
      totalCredit: 40,
      closingBalance: 60,
    });
  });

  it('keeps payable balances signed as credit balances', () => {
    const summary = calculatePartyStatementSummary({
      allEntries,
      statementEntries: allEntries.slice(1),
      currentBalance: 25,
      balanceType: 'YOU_WILL_GIVE',
      periodStart: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(summary).toEqual({
      openingBalance: -5,
      totalDebit: 20,
      totalCredit: 40,
      closingBalance: -25,
    });
  });

  it('uses each entry note and amount column in newest-first order with chronological balances', () => {
    const rows = buildPartyStatementRows(allEntries.slice(1), 110);

    expect(rows.map(({ id, details, debit, credit, balanceAfter }) => ({
      id, details, debit, credit, balanceAfter,
    }))).toEqual([
      {
        id: 'debit',
        details: 'নগদ প্রদান (বিল: B-17)',
        debit: 20,
        credit: null,
        balanceAfter: 90,
      },
      {
        id: 'credit',
        details: 'পুরোনো বাকি পরিশোধ',
        debit: null,
        credit: 40,
        balanceAfter: 70,
      },
    ]);
  });

  it('keeps backdated day groups contiguous and presents them newest first', () => {
    const entries: PartyStatementEntry[] = [
      {
        id: 'october-first-created',
        type: 'YOU_GOT',
        amount: 500,
        createdAt: '2026-10-02T16:45:00.000Z',
        dueDate: '2026-10-02',
      },
      {
        id: 'january-2025',
        type: 'YOU_GAVE',
        amount: 200,
        createdAt: '2026-10-02T16:45:10.000Z',
        dueDate: '2025-01-02',
      },
      {
        id: 'october-second-created',
        type: 'YOU_GOT',
        amount: 5111,
        createdAt: '2026-10-02T16:45:20.000Z',
        dueDate: '2026-10-02',
      },
      {
        id: 'january-2024',
        type: 'YOU_GAVE',
        amount: 80,
        createdAt: '2026-10-02T16:46:00.000Z',
        dueDate: '2024-01-01',
      },
    ];

    const rows = buildPartyStatementRows(entries, 0);

    expect(rows.map(({ id, dayKey }) => [id, dayKey])).toEqual([
      ['october-second-created', '2026-10-02'],
      ['october-first-created', '2026-10-02'],
      ['january-2025', '2025-01-02'],
      ['january-2024', '2024-01-01'],
    ]);
    expect(rows.map(({ balanceAfter }) => balanceAfter)).toEqual([-5331, -220, 280, 80]);
  });

  it('uses the entered business date and local creation time for each statement row', () => {
    const createdAt = '2025-05-01T10:55:00.000Z';
    const [row] = buildPartyStatementRows([{
      id: 'backdated',
      type: 'YOU_GAVE',
      amount: 10,
      createdAt,
      dueDate: '2025-04-30',
    }], 0);

    expect(row.dayKey).toBe('2025-04-30');
    expect(row.dayLabel).toContain('30');
    expect(row.dateTime).toMatch(/^30 .+ 25 • /);
    expect(row.dateTime).toBe(`${row.dateTime.split(' • ')[0]} • ${formatLocalTime(createdAt)}`);
  });

  it('keeps ISO-serialized date-only values on their original calendar day', () => {
    expect(getLedgerEntryDateKey(
      '2025-04-30T00:00:00.000Z',
      '2025-05-01T10:55:00.000Z',
    )).toBe('2025-04-30');
  });
});