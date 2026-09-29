import {
  resolveGlobalLedgerReportRange,
  type GlobalLedgerReportPeriod,
  type GlobalLedgerReportRange,
} from '@workspace/api-client-react/global-ledger-report';
import type { GlobalLedgerEntry } from '@workspace/api-client-react';

export type BusinessReportPeriod = GlobalLedgerReportPeriod;

export const BUSINESS_REPORT_PERIODS: { key: BusinessReportPeriod; label: string }[] = [
  { key: 'ALL', label: 'সব' },
  { key: 'THIS_MONTH', label: 'এই মাসে' },
  { key: 'SINGLE_DAY', label: 'এক দিন' },
  { key: 'LAST_WEEK', label: 'গত সপ্তাহে' },
  { key: 'LAST_MONTH', label: 'গত মাসের' },
  { key: 'CUSTOM_RANGE', label: 'তারিখের পরিসর' },
];

export type BusinessReportRange = GlobalLedgerReportRange;

const BENGALI_DIGITS: Record<string, string> = {
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

export function toBengaliDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => BENGALI_DIGITS[digit] ?? digit);
}

export function formatBusinessDate(date: Date): string {
  return `${toBengaliDigits(date.getDate())} ${MONTHS_BN[date.getMonth()]} ${toBengaliDigits(date.getFullYear())}`;
}

export function formatBusinessCurrency(value: number): string {
  const amount = Number.isFinite(value) ? Math.abs(value) : 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `৳${toBengaliDigits(formatted)}`;
}

export function resolveBusinessReportRange(
  period: BusinessReportPeriod,
  customStart: Date | null,
  customEnd: Date | null,
  now = new Date(),
): BusinessReportRange {
  return resolveGlobalLedgerReportRange(period, customStart, customEnd, now);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return character;
    }
  });
}

function parseStoredDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
}

function htmlDate(value: string): string {
  const date = parseStoredDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return escapeHtml(formatBusinessDate(date));
}

function htmlMoney(value: number): string {
  return escapeHtml(formatBusinessCurrency(value));
}

export function buildBusinessReportHtml(options: {
  storeName: string;
  periodLabel: string;
  entries: GlobalLedgerEntry[];
  totalDebit: number;
  totalCredit: number;
}): string {
  const netBalance = options.totalCredit - options.totalDebit;
  const amountDirection = netBalance > 0 ? 'Cr' : netBalance < 0 ? 'Dr' : '';
  const generatedAt = new Date();
  const generatedDate = escapeHtml(formatBusinessDate(generatedAt));
  const generatedTime = toBengaliDigits(
    generatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
  );

  const rows = [...options.entries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((entry) => {
      const isDebit = entry.type === 'YOU_GAVE';
      const created = new Date(entry.createdAt);
      const date = Number.isNaN(created.getTime())
        ? '—'
        : `${formatBusinessDate(created)} · ${toBengaliDigits(created.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))}`;
      const details = [
        entry.description?.trim(),
        entry.billReference ? `বিল: ${entry.billReference}` : '',
        entry.dueDate ? `বাকি তারিখ: ${htmlDate(entry.dueDate)}` : '',
      ].filter(Boolean).map((value) => escapeHtml(String(value))).join('<br/>');

      return `<tr>
        <td>${escapeHtml(date)}</td>
        <td class="party">${escapeHtml(entry.partyName || '—')}</td>
        <td class="details">${details || '—'}</td>
        <td class="debit">${isDebit ? htmlMoney(entry.amount) : ''}</td>
        <td class="credit">${isDebit ? '' : htmlMoney(entry.amount)}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #132949; font-family: 'Noto Sans Bengali', sans-serif; font-size: 10px; }
    .brand { display: flex; justify-content: space-between; align-items: center; background: #1b3c69; color: #fff; padding: 14px 18px; }
    .store { font-size: 15px; font-weight: 700; }
    .brand-name { font-size: 12px; font-weight: 700; }
    main { padding: 20px 0; }
    h1 { margin: 0; text-align: center; font-size: 18px; }
    .period { margin-top: 5px; color: #64748b; text-align: center; font-size: 10px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #e2e8f0; margin: 18px 0; }
    .metric { padding: 11px; border-right: 1px solid #e2e8f0; }
    .metric:last-child { border-right: 0; }
    .label { color: #64748b; font-size: 9px; }
    .value { margin-top: 3px; font-size: 13px; font-weight: 700; }
    .debit { color: #b91c1c; background: #fff5f5; text-align: right; }
    .credit { color: #15803d; background: #f0fdf4; text-align: right; }
    .count { margin: 0 0 8px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #cbd5e1; padding: 7px; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f8fafc; text-align: left; font-weight: 700; }
    td.party { font-weight: 600; }
    td.details { color: #475569; }
    .empty { text-align: center; color: #64748b; padding: 18px; }
    footer { margin-top: 18px; color: #64748b; text-align: center; font-size: 8px; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  </style>
</head>
<body>
  <div class="brand">
    <span class="store">${escapeHtml(options.storeName || 'বাংলা খাতা')}</span>
    <span class="brand-name">বাংলা খাতা</span>
  </div>
  <main>
    <h1>ব্যবসার লেনদেনের রিপোর্ট</h1>
    <div class="period">${escapeHtml(options.periodLabel)} · ${generatedDate} · ${generatedTime}</div>
    <div class="summary">
      <div class="metric"><div class="label">মোট ব্যালেন্স</div><div class="value">${htmlMoney(Math.abs(netBalance))} ${amountDirection}</div></div>
      <div class="metric"><div class="label">মোট দিয়েছেন (ডেবিট)</div><div class="value debit">${htmlMoney(options.totalDebit)}</div></div>
      <div class="metric"><div class="label">মোট পেয়েছেন (ক্রেডিট)</div><div class="value credit">${htmlMoney(options.totalCredit)}</div></div>
    </div>
    <p class="count">মোট এন্ট্রি: ${toBengaliDigits(options.entries.length)}</p>
    <table>
      <thead><tr>
        <th style="width:20%">তারিখ</th>
        <th style="width:22%">পার্টি</th>
        <th>বিস্তারিত</th>
        <th style="width:16%;text-align:right">ডেবিট (-)</th>
        <th style="width:16%;text-align:right">ক্রেডিট (+)</th>
      </tr></thead>
      <tbody>
        ${rows || '<tr><td class="empty" colspan="5">এই সময়কালে কোনো লেনদেন নেই</td></tr>'}
      </tbody>
    </table>
    <footer>তৈরি করা হয়েছে বাংলা খাতা মোবাইল অ্যাপ থেকে · ${generatedDate}</footer>
  </main>
</body>
</html>`;
}