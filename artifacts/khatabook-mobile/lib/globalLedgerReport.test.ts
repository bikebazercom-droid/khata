import { describe, expect, it } from 'vitest';
import type { GlobalLedgerRecord, PartyRecord } from '@/lib/domain';
import { calculateGlobalLedgerReportTotals, resolveGlobalLedgerReportRange } from '@workspace/api-client-react/global-ledger-report';
import {
  buildGlobalLedgerReportCsv,
  filterGlobalLedgerEntriesByRole,
  parseReportDate,
} from '@/lib/globalLedgerReport';

const entry = (overrides: Partial<GlobalLedgerRecord> = {}): GlobalLedgerRecord => ({
  id: 'entry-1',
  partyId: 'party-1',
  partyName: 'Alice',
  partyPhone: '',
  type: 'YOU_GAVE',
  amount: 12.5,
  description: 'sale',
  billReference: null,
  billImage: null,
  dueDate: null,
  createdAt: '2025-06-15T11:20:00.000Z',
  ...overrides,
});

describe('global mobile report helpers', () => {
  it('resolves web-aligned presets and validates a date-only value', () => {
    expect(resolveGlobalLedgerReportRange('LAST_WEEK', null, null, new Date(2025, 5, 15)))
      .toEqual({ startDate: '2025-06-09', endDate: '2025-06-15' });
    expect(resolveGlobalLedgerReportRange(
      'CUSTOM_RANGE',
      new Date(2025, 4, 2),
      new Date(2025, 4, 9),
    )).toEqual({ startDate: '2025-05-02', endDate: '2025-05-09' });
    expect(parseReportDate('2024-02-29')?.getDate()).toBe(29);
    expect(parseReportDate('2025-02-29')).toBeNull();
  });

  it('maps role filters to actual party roles and calculates totals', () => {
    const records = [
      entry({ id: 'customer', partyId: 'c', type: 'YOU_GOT', amount: 20 }),
      entry({ id: 'supplier', partyId: 's', type: 'YOU_GAVE', amount: 7 }),
      entry({ id: 'unknown', partyId: 'gone' }),
    ];
    const parties = [
      { id: 'c', role: 'CUSTOMER' },
      { id: 's', role: 'SUPPLIER' },
    ] as PartyRecord[];
    const filtered = filterGlobalLedgerEntriesByRole(records, parties, 'CUSTOMER');
    expect(filtered.map((item) => item.id)).toEqual(['customer']);
    expect(calculateGlobalLedgerReportTotals(filtered)).toMatchObject({
      totalDebit: 0,
      totalCredit: 20,
      netBalance: 20,
      entryCount: 1,
    });
  });

  it('quotes CSV fields, protects formulas, includes UTF-8 BOM and CRLF', () => {
    const csv = buildGlobalLedgerReportCsv([
      entry({ partyName: '=SUM(A1:A2)', description: 'a,"note"\nsecond line' }),
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).toContain('"a,""note""\nsecond line"');
    expect(csv).toContain('\r\n');
    expect(csv).toMatch(/,12\.50,\r\n$/);
  });
});