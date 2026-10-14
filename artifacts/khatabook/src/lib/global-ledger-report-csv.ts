import type { GlobalLedgerEntry } from '@workspace/api-client-react';
import { format } from 'date-fns';

type CsvEntry = Pick<GlobalLedgerEntry, 'createdAt' | 'partyName' | 'description' | 'type' | 'amount'>;

const HEADERS = {
  bn: ['তারিখ', 'পার্টির নাম', 'বিবরণ', 'আপনি দিয়েছেন (৳)', 'আপনি পেয়েছেন (৳)'],
  en: ['Date', 'Party name', 'Details', 'You gave (৳)', 'You received (৳)'],
} as const;
const UTF8_BOM = '\uFEFF';

function protectSpreadsheetFormula(value: string): string {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvField(value: string | number): string {
  const text = typeof value === 'string' ? protectSpreadsheetFormula(value) : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
}

export function buildGlobalLedgerReportCsv(entries: readonly CsvEntry[], lang: 'bn' | 'en' = 'bn'): string {
  const rows = entries.map((entry) => {
    const isDebit = entry.type === 'YOU_GAVE';
    return [
      lang === 'en'
        ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(entry.createdAt))
        : format(new Date(entry.createdAt), 'yyyy-MM-dd hh:mm:ss a'),
      entry.partyName,
      entry.description ?? '',
      isDebit ? entry.amount.toFixed(2) : '',
      isDebit ? '' : entry.amount.toFixed(2),
    ].map(escapeCsvField).join(',');
  });

  // Keep exactly one UTF-8 BOM at byte zero so spreadsheet apps detect Bengali
  // and other Unicode text correctly. CRLF is the CSV record separator.
  const csvBody = `${[HEADERS[lang].map(escapeCsvField).join(','), ...rows].join('\r\n')}\r\n`;
  return `${UTF8_BOM}${csvBody.replace(/^\uFEFF/, '')}`;
}