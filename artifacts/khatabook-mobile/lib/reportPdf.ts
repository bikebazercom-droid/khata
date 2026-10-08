import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { billImageUrl, formatDate, formatMoney, type GlobalLedgerRecord, type LedgerRecord, type PartyRecord } from '@/lib/domain';
import { calculateGlobalLedgerReportTotals } from '@workspace/api-client-react/global-ledger-report';
import { getLedgerEntryDateKey } from '@workspace/api-client-react/ledger-domain';

export type StatementPeriod = 'all' | 'month' | '30days' | 'custom';

export type StatementOptions = {
  startDate?: Date | null;
  endDate?: Date | null;
  search?: string;
};

export type PartyStatement = {
  entries: LedgerRecord[];
  entriesAscending: LedgerRecord[];
  rangeStart: Date | null;
  rangeEnd: Date | null;
  openingBalance: number;
  gave: number;
  received: number;
  closingBalance: number;
  runningBalances: Map<string, number>;
};

function localDateKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid ledger entry date');
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromLocalKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

function ledgerEntryDateKey(entry: Pick<LedgerRecord, 'dueDate' | 'createdAt'>): string {
  return getLedgerEntryDateKey(entry.dueDate, entry.createdAt);
}

function compareLedgerEntriesChronologically(
  left: Pick<LedgerRecord, 'id' | 'dueDate' | 'createdAt'>,
  right: Pick<LedgerRecord, 'id' | 'dueDate' | 'createdAt'>,
): number {
  const dayOrder = ledgerEntryDateKey(left).localeCompare(ledgerEntryDateKey(right));
  if (dayOrder) return dayOrder;
  const timeOrder = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  return timeOrder || left.id.localeCompare(right.id);
}

function sortLedgerEntriesChronologically<T extends Pick<LedgerRecord, 'id' | 'dueDate' | 'createdAt'>>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(compareLedgerEntriesChronologically);
}

function entryDelta(entry: LedgerRecord): number {
  return entry.type === 'YOU_GAVE' ? entry.amount : -entry.amount;
}

export function calculatePartyStatement(
  entries: LedgerRecord[],
  period: StatementPeriod,
  now = new Date(),
  options: StatementOptions = {},
): PartyStatement {
  let start: Date | null = null;
  if (period === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === '30days') start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  if (period === 'custom') start = options.startDate ?? null;
  const startKey = start ? localDateKey(start) : null;
  const endDate = period === 'custom' && options.endDate ? options.endDate : now;
  const endKey = localDateKey(endDate);

  const inRange = (entry: LedgerRecord) => {
    const dayKey = ledgerEntryDateKey(entry);
    return (!startKey || dayKey >= startKey)
      && (period === 'all' || dayKey <= endKey);
  };
  const dateFiltered = entries.filter(inRange);
  const normalizedSearch = options.search?.trim().toLocaleLowerCase();
  const filtered = normalizedSearch
    ? dateFiltered.filter((entry) => (entry.description ?? '').toLocaleLowerCase().includes(normalizedSearch))
    : dateFiltered;
  const openingBalance = startKey
    ? entries
      .filter((entry) => ledgerEntryDateKey(entry) < startKey)
      .reduce((balance, entry) => balance + entryDelta(entry), 0)
    : 0;
  const entriesAscending = sortLedgerEntriesChronologically(dateFiltered);
  let runningBalance = openingBalance;
  const runningBalances = new Map<string, number>();
  for (const entry of entriesAscending) {
    runningBalance += entryDelta(entry);
    runningBalances.set(entry.id, runningBalance);
  }
  const gave = dateFiltered.reduce((total, entry) => total + (entry.type === 'YOU_GAVE' ? entry.amount : 0), 0);
  const received = dateFiltered.reduce((total, entry) => total + (entry.type === 'YOU_GOT' ? entry.amount : 0), 0);
  const allDateKeys = period === 'all'
    ? entries.map(ledgerEntryDateKey).sort()
    : [];

  return {
    entries: sortLedgerEntriesChronologically(filtered).reverse(),
    entriesAscending: entriesAscending.filter((entry) => !normalizedSearch || (entry.description ?? '').toLocaleLowerCase().includes(normalizedSearch)),
    rangeStart: period === 'all'
      ? (allDateKeys.length ? dateFromLocalKey(allDateKeys[0]!) : null)
      : start,
    rangeEnd: period === 'all'
      ? (allDateKeys.length ? dateFromLocalKey(allDateKeys[allDateKeys.length - 1]!) : null)
      : endDate,
    openingBalance,
    gave,
    received,
    closingBalance: openingBalance + gave - received,
    runningBalances,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function money(value: number): string {
  return escapeHtml(formatMoney(value));
}

function balanceLabel(value: number): string {
  if (Math.abs(value) < 0.005) return 'হিসাব সমান';
  return `${money(Math.abs(value))} ${value > 0 ? 'পাওনা' : 'দেনা'}`;
}

function reportShell(title: string, businessName: string, body: string): string {
  return `<!doctype html>
  <html lang="bn">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @page {
          size: A4;
          margin: 25mm 14mm 22mm;
          @bottom-left {
            content: "বাংলাখাতা · এই প্রতিবেদনটি অ্যাপ থেকে তৈরি করা হয়েছে।";
            color: #fff;
            background: #1b426f;
            font: 9px system-ui, "Noto Sans Bengali", sans-serif;
            padding: 8px 12px;
          }
          @bottom-right {
            content: "Page " counter(page) " of " counter(pages);
            color: #fff;
            background: #1b426f;
            font: 9px Arial, sans-serif;
            padding: 8px 12px;
          }
        }
        * { box-sizing: border-box; }
        body { margin: 0; color: #13283e; font-family: system-ui, "Noto Sans Bengali", "Noto Sans", sans-serif; font-size: 12px; }
        .brand { position: fixed; top: -21mm; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px; background: #1b426f; color: #fff; }
        .brand-name { min-width: 0; font-size: 14px; line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; }
        .brand-mark { display: flex; flex: 0 0 auto; align-items: center; gap: 7px; white-space: nowrap; font-size: 13px; font-weight: 700; }
        .brand-icon { font-size: 18px; line-height: 1; }
        .body { padding: 0 4px 8px; }
        h1 { margin: 0 0 6px; text-align: center; font-size: 20px; }
        .subtitle { text-align: center; color: #64748b; margin-bottom: 18px; }
        .summary { display: flex; gap: 8px; margin: 14px 0 20px; break-inside: avoid; page-break-inside: avoid; }
        .summary-card { flex: 1; border: 1px solid #dce5ee; border-radius: 8px; padding: 10px; }
        .summary-label { color: #64748b; font-size: 10px; margin-bottom: 5px; }
        .summary-value { font-weight: 700; font-size: 13px; }
        .red { color: #b42318; } .green { color: #16845b; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
        th, td { padding: 7px 6px; border: 1px solid #dce5ee; text-align: left; vertical-align: top; }
        th { background: #f0f4f8; font-weight: 700; }
        thead { display: table-header-group; }
        tbody { display: table-row-group; }
        tr, img, .opening-balance { break-inside: avoid; page-break-inside: avoid; }
        .date-heading { break-after: avoid; page-break-after: avoid; }
        .right { text-align: right; white-space: nowrap; }
        .grand-total { break-inside: avoid; page-break-inside: avoid; font-weight: 700; background: #f8fafc; }
        .grand-total td { border-color: #cbd5e1; }
      </style>
    </head>
    <body>
      <header class="brand">
        <div class="brand-name">${escapeHtml(businessName || 'বাংলাখাতা')}</div>
        <div class="brand-mark" aria-label="বাংলা খাতা">
          <span class="brand-icon" aria-hidden="true">📒</span>
          <span>বাংলা খাতা</span>
        </div>
      </header>
      <main class="body">
        <h1>${escapeHtml(title)}</h1>
        ${body}
      </main>
    </body>
  </html>`;
}

export function buildPartyStatementHtml({
  businessName,
  party,
  statement,
  billImages = new Map(),
}: {
  businessName: string;
  party: PartyRecord;
  statement: PartyStatement;
  billImages?: Map<string, string>;
}): string {
  const rows = sortLedgerEntriesChronologically(statement.entriesAscending).map((entry) => {
    const isGave = entry.type === 'YOU_GAVE';
    const amount = money(entry.amount);
    const runningBalance = statement.runningBalances.get(entry.id) ?? 0;
    const description = entry.description || (entry.isTransfer ? 'ট্রান্সফার' : isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন');
    return `<tr class="statement-row">
      <td>${escapeHtml(formatDate(ledgerEntryDateKey(entry)))}</td>
      <td>${escapeHtml(description)}${entry.billReference ? `<br><span style="color:#64748b">রেফ: ${escapeHtml(entry.billReference)}</span>` : ''}${billImages.has(entry.id) ? `<br><img src="${escapeHtml(billImages.get(entry.id) ?? '')}" alt="বিলের ছবি" style="width:64px;height:48px;object-fit:cover;margin-top:4px;border-radius:4px" />` : ''}</td>
      <td class="right ${isGave ? 'red' : ''}">${isGave ? amount : '—'}</td>
      <td class="right ${!isGave ? 'green' : ''}">${isGave ? '—' : amount}</td>
      <td class="right">${escapeHtml(balanceLabel(runningBalance))}</td>
    </tr>`;
  }).join('');
  const roleLabel = party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার';
  const dateRangeLabel = statement.rangeStart && statement.rangeEnd
    ? `${formatDate(localDateKey(statement.rangeStart))} - ${formatDate(localDateKey(statement.rangeEnd))}`
    : 'কোনো লেনদেন নেই';
  const body = `
    <div class="subtitle">${roleLabel}${party.phone ? ` · ${escapeHtml(party.phone)}` : ''}<br>${escapeHtml(dateRangeLabel)}</div>
    <div class="summary">
      <div class="summary-card"><div class="summary-label">আপনি দিয়েছেন</div><div class="summary-value red">${money(statement.gave)}</div></div>
      <div class="summary-card"><div class="summary-label">আপনি পেয়েছেন</div><div class="summary-value green">${money(statement.received)}</div></div>
      <div class="summary-card"><div class="summary-label">বর্তমান ব্যালেন্স</div><div class="summary-value">${escapeHtml(balanceLabel(statement.closingBalance))}</div></div>
    </div>
    <p class="opening-balance">ওপেনিং ব্যালেন্স: <strong>${escapeHtml(balanceLabel(statement.openingBalance))}</strong></p>
    <table class="statement-table">
      <thead><tr>
        <th style="width:16%">তারিখ</th>
        <th style="width:34%">ডিটেলস</th>
        <th class="right" style="width:16%">ডেবিট (-)</th>
        <th class="right" style="width:16%">ক্রেডিট (+)</th>
        <th class="right" style="width:18%">ব্যালেন্স</th>
      </tr></thead>
      <tbody>
        ${rows || '<tr><td colspan="5" style="text-align:center;color:#64748b">এই সময়ে কোনো লেনদেন নেই</td></tr>'}
        <tr class="grand-total">
          <td colspan="2">সর্বমোট</td>
          <td class="right red">${money(statement.gave)}</td>
          <td class="right green">${money(statement.received)}</td>
          <td class="right">${escapeHtml(balanceLabel(statement.closingBalance))}</td>
        </tr>
      </tbody>
    </table>`;
  return reportShell(`${party.name} এর স্টেটমেন্ট`, businessName, body);
}

export function buildGlobalLedgerReportHtml({
  businessName,
  entries,
  periodLabel,
}: {
  businessName: string;
  entries: GlobalLedgerRecord[];
  periodLabel: string;
}): string {
  const totals = calculateGlobalLedgerReportTotals(entries);
  const rows = sortLedgerEntriesChronologically(entries).map((entry) => {
    const debit = entry.type === 'YOU_GAVE';
    return `<tr>
      <td>${escapeHtml(formatDate(ledgerEntryDateKey(entry)))}</td>
      <td>${escapeHtml(entry.partyName)}${entry.partyPhone ? `<br><span style="color:#64748b">${escapeHtml(entry.partyPhone)}</span>` : ''}</td>
      <td>${escapeHtml(entry.description || (entry.isTransfer ? 'ট্রান্সফার' : '—'))}${entry.billReference ? `<br><span style="color:#64748b">রেফ: ${escapeHtml(entry.billReference)}</span>` : ''}</td>
      <td class="right ${debit ? 'red' : ''}">${debit ? money(entry.amount) : '—'}</td>
      <td class="right ${!debit ? 'green' : ''}">${!debit ? money(entry.amount) : '—'}</td>
    </tr>`;
  }).join('');
  const body = `
    <div class="subtitle">${escapeHtml(periodLabel)} · ${entries.length}টি লেনদেন</div>
    <div class="summary">
      <div class="summary-card"><div class="summary-label">মোট ডেবিট</div><div class="summary-value red">${money(totals.totalDebit)}</div></div>
      <div class="summary-card"><div class="summary-label">মোট ক্রেডিট</div><div class="summary-value green">${money(totals.totalCredit)}</div></div>
      <div class="summary-card"><div class="summary-label">নিট ব্যালেন্স</div><div class="summary-value">${money(totals.netBalance)}</div></div>
    </div>
    <table>
      <thead><tr><th>তারিখ</th><th>পার্টি</th><th>বিবরণ</th><th class="right">ডেবিট</th><th class="right">ক্রেডিট</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#64748b">এই সময়ে কোনো লেনদেন নেই</td></tr>'}</tbody>
    </table>`;
  return reportShell('লেনদেন রিপোর্ট', businessName, body);
}

const MAX_EMBEDDED_IMAGE_BYTES = 1024 * 1024;

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    result += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    result += third === undefined ? '=' : alphabet[third & 63];
  }
  return result;
}

export async function embedPartyStatementBillImages(
  entries: readonly LedgerRecord[],
  token: string | null,
): Promise<{ images: Map<string, string>; failedCount: number }> {
  const images = new Map<string, string>();
  let failedCount = 0;
  const withImages = entries.filter((entry) => entry.billImage);
  await Promise.all(withImages.map(async (entry) => {
    try {
      const image = entry.billImage!;
      if (image.startsWith('data:')) {
        if (!image.startsWith('data:image/') || image.length > MAX_EMBEDDED_IMAGE_BYTES * 1.4) {
          throw new Error('Invalid or oversized embedded image');
        }
        images.set(entry.id, image);
        return;
      }
      const url = billImageUrl(image);
      if (!url) return;
      const protectedObject = image.startsWith('/objects/');
      const response = await fetch(url, {
        credentials: protectedObject ? 'include' : 'omit',
        headers: protectedObject && token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) throw new Error(`Image request failed (${response.status})`);
      const contentType = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!contentType.startsWith('image/')) throw new Error('Invalid image content type');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_EMBEDDED_IMAGE_BYTES) throw new Error('Image exceeds PDF limit');
      images.set(entry.id, `data:${contentType};base64,${encodeBase64(bytes)}`);
    } catch {
      failedCount += 1;
    }
  }));
  return { images, failedCount };
}

export function buildPartyBalancesHtml({
  businessName,
  parties,
  role,
}: {
  businessName: string;
  parties: PartyRecord[];
  role: 'ALL' | 'CUSTOMER' | 'SUPPLIER';
}): string {
  const totalGet = parties.reduce((sum, party) => sum + (party.balanceType === 'YOU_WILL_GET' ? party.currentBalance : 0), 0);
  const totalGive = parties.reduce((sum, party) => sum + (party.balanceType === 'YOU_WILL_GIVE' ? party.currentBalance : 0), 0);
  const roleLabel = role === 'ALL' ? 'সব হিসাব' : role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার';
  const rows = parties.map((party) => {
    const owes = party.balanceType === 'YOU_WILL_GET';
    return `<tr>
      <td>${escapeHtml(party.name)}</td>
      <td>${escapeHtml(party.phone || '—')}</td>
      <td class="right ${!owes && party.currentBalance ? 'red' : ''}">${!owes ? money(party.currentBalance) : '—'}</td>
      <td class="right ${owes && party.currentBalance ? 'green' : ''}">${owes ? money(party.currentBalance) : '—'}</td>
      <td>${escapeHtml(party.lastTransactionAt ? formatDate(party.lastTransactionAt) : '—')}</td>
    </tr>`;
  }).join('');
  const body = `
    <div class="subtitle">${roleLabel} · ${parties.length}টি হিসাব</div>
    <div class="summary">
      <div class="summary-card"><div class="summary-label">আপনি পাবেন</div><div class="summary-value green">${money(totalGet)}</div></div>
      <div class="summary-card"><div class="summary-label">আপনি দেবেন</div><div class="summary-value red">${money(totalGive)}</div></div>
      <div class="summary-card"><div class="summary-label">মোট হিসাব</div><div class="summary-value">${parties.length}</div></div>
    </div>
    <table>
      <thead><tr><th>নাম</th><th>ফোন</th><th class="right">দিতে হবে</th><th class="right">পাওনা</th><th>শেষ লেনদেন</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#64748b">কোনো হিসাব নেই</td></tr>'}</tbody>
    </table>`;
  return reportShell(`${roleLabel} রিপোর্ট`, businessName, body);
}

export async function shareReportPdf(html: string, title: string): Promise<'shared' | 'printed'> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return 'printed';
  }

  const file = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) {
    await Print.printAsync({ html });
    return 'printed';
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
  return 'shared';
}