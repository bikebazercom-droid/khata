import { describe, expect, it } from 'vitest';
import type { GlobalLedgerEntry } from '@workspace/api-client-react';
import { buildGlobalLedgerReportCsv } from '../lib/global-ledger-report-csv';

type CsvEntry = Pick<GlobalLedgerEntry, 'createdAt' | 'partyName' | 'description' | 'type' | 'amount'>;

function makeEntry(overrides: Partial<CsvEntry> = {}): CsvEntry {
  return {
    createdAt: new Date(2026, 8, 15, 17, 30).toISOString(),
    partyName: 'রহিম, "মিয়া"',
    description: 'প্রথম লাইন\r\nদ্বিতীয় লাইন',
    type: 'YOU_GAVE',
    amount: 125.5,
    ...overrides,
  };
}

describe('buildGlobalLedgerReportCsv', () => {
  it('exports Bengali headings, sortable timestamps, and debit/credit values', () => {
    const csv = buildGlobalLedgerReportCsv([
      makeEntry(),
      makeEntry({
        createdAt: new Date(2026, 8, 16, 9, 5).toISOString(),
        partyName: 'করিম',
        description: 'পেমেন্ট',
        type: 'YOU_GOT',
        amount: 80,
      }),
    ]);

    expect(csv).toBe(
      '\uFEFFতারিখ,পার্টির নাম,বিবরণ,ডেবিট (-),ক্রেডিট (+)\r\n' +
      '2026-09-15 17:30:00,"রহিম, ""মিয়া""","প্রথম লাইন\r\nদ্বিতীয় লাইন",125.50,\r\n' +
      '2026-09-16 09:05:00,করিম,পেমেন্ট,,80.00\r\n',
    );
  });

  it('escapes formula-like user text before spreadsheet apps evaluate it', () => {
    const csv = buildGlobalLedgerReportCsv([
      makeEntry({ partyName: '=HYPERLINK("https://example.com")', description: '+1,2' }),
    ]);

    expect(csv).toContain(`,"'=HYPERLINK(""https://example.com"")","'+1,2",125.50,`);
  });

  it('returns a valid header-only CSV when no filtered entries match', () => {
    expect(buildGlobalLedgerReportCsv([])).toBe(
      '\uFEFFতারিখ,পার্টির নাম,বিবরণ,ডেবিট (-),ক্রেডিট (+)\r\n',
    );
  });
});