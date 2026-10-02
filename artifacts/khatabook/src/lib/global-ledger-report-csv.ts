import type { GlobalLedgerEntry } from '@workspace/api-client-react';
import { format } from 'date-fns';

type CsvEntry = Pick<GlobalLedgerEntry, 'createdAt' | 'partyName' | 'description' | 'type' | 'amount'>;

const HEADERS = ['তারিখ', 'পার্টির নাম', 'বিবরণ', 'ডেবিট (-)', 'ক্রেডিট (+)'] as const;

function protectSpreadsheetFormula(value: string): string {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvField(value: string | number): string {
  const text = typeof value === 'string' ? protectSpreadsheetFormula(value) : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
}

export function buildGlobalLedgerReportCsv(entries: readonly CsvEntry[]): string {
  const rows = entries.map((entry) => {
    const isDebit = entry.type === 'YOU_GAVE';
    return [
      format(new Date(entry.createdAt), 'yyyy-MM-dd hh:mm:ss a'),
      entry.partyName,
      entry.description ?? '',
      isDebit ? entry.amount.toFixed(2) : '',
      isDebit ? '' : entry.amount.toFixed(2),
    ].map(escapeCsvField).join(',');
  });

  // BOM helps spreadsheet apps recognize Bengali text; CRLF is the CSV record separator.
  return `\uFEFF${[HEADERS.map(escapeCsvField).join(','), ...rows].join('\r\n')}\r\n`;
}