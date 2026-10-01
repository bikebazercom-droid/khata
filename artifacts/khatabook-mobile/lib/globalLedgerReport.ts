import type { GlobalLedgerRecord, PartyRecord } from '@/lib/domain';
import type { GlobalLedgerReportPeriod } from '@workspace/api-client-react/global-ledger-report';

export type GlobalLedgerRole = 'ALL' | 'CUSTOMER' | 'SUPPLIER';

const CSV_HEADERS = ['তারিখ', 'পার্টির নাম', 'বিবরণ', 'ডেবিট (-)', 'ক্রেডিট (+)'] as const;

function protectSpreadsheetFormula(value: string): string {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvField(value: string | number): string {
  const text = typeof value === 'string' ? protectSpreadsheetFormula(value) : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
}

export function buildGlobalLedgerReportCsv(entries: readonly GlobalLedgerRecord[]): string {
  const rows = entries.map((entry) => {
    const isDebit = entry.type === 'YOU_GAVE';
    const date = new Date(entry.createdAt);
    const dateText = Number.isFinite(date.getTime())
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
      : entry.createdAt;
    return [
      dateText,
      entry.partyName,
      entry.description ?? '',
      isDebit ? entry.amount.toFixed(2) : '',
      isDebit ? '' : entry.amount.toFixed(2),
    ].map(escapeCsvField).join(',');
  });

  return `\uFEFF${[CSV_HEADERS.map(escapeCsvField).join(','), ...rows].join('\r\n')}\r\n`;
}

export function filterGlobalLedgerEntriesByRole(
  entries: readonly GlobalLedgerRecord[],
  parties: readonly PartyRecord[],
  role: GlobalLedgerRole,
): GlobalLedgerRecord[] {
  if (role === 'ALL') return [...entries];
  const partyRoles = new Map(parties.map((party) => [party.id, party.role]));
  return entries.filter((entry) => partyRoles.get(entry.partyId) === role);
}

export type ReportDatePreset = {
  value: GlobalLedgerReportPeriod;
  label: string;
};

export const GLOBAL_LEDGER_PRESETS: ReportDatePreset[] = [
  { value: 'ALL', label: 'সব সময়' },
  { value: 'THIS_MONTH', label: 'এই মাস' },
  { value: 'SINGLE_DAY', label: 'এক দিন' },
  { value: 'LAST_WEEK', label: 'গত ৭ দিন' },
  { value: 'LAST_MONTH', label: 'গত মাস' },
  { value: 'CUSTOM_RANGE', label: 'নিজস্ব সময়' },
];

export function parseReportDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

export function formatReportDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}