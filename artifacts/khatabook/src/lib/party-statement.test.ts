import { describe, expect, it } from 'vitest';
import {
  buildPartyStatementRows,
  calculatePartyStatementSummary,
  type PartyStatementEntry,
} from './party-statement';

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

  it('uses each entry note, amount column, and chronological running balance', () => {
    const rows = buildPartyStatementRows(allEntries.slice(1), 110);

    expect(rows.map(({ id, details, debit, credit, balanceAfter }) => ({
      id, details, debit, credit, balanceAfter,
    }))).toEqual([
      {
        id: 'credit',
        details: 'পুরোনো বাকি পরিশোধ',
        debit: null,
        credit: 40,
        balanceAfter: 70,
      },
      {
        id: 'debit',
        details: 'নগদ প্রদান (বিল: B-17)',
        debit: 20,
        credit: null,
        balanceAfter: 90,
      },
    ]);
  });
});