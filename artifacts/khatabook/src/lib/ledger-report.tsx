import { forwardRef, Fragment } from 'react';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { billImageSrc } from '@/lib/billImageStorage';
import { BillAttachmentPreview } from '@/components/bill-attachment-preview';
import { getLedgerEntryDateKey } from './date-time';
import { splitAdjustmentDescription } from './adjustment-display';
import { fitPdfHeaderNameFontSize, getPdfSupportContactLinks } from './pdf-report-branding';
import { buildPortablePdfFilename } from './report-filename';

export interface ReportEntry {
  id: string;
  type: 'YOU_GAVE' | 'YOU_GOT';
  amount: number;
  description: string;
  billReference: string | null;
  billImage?: string | null;
  dueDate: string | null;
  createdAt: string | Date;
  balanceAfter: number;
  isTransfer?: boolean;
  transferPartyName?: string | null;
}

export interface ReportParty {
  name: string;
  phone: string;
  currentBalance: number;
  balanceType: 'YOU_WILL_GIVE' | 'YOU_WILL_GET';
}

interface LedgerReportDocumentProps {
  storeName: string;
  party: ReportParty;
  entries: ReportEntry[];
  supportPhone?: string | null;
  supportEmail?: string | null;
}

/** The entry's real transaction date, normalized to a Date object. */
function entryDateKey(entry: ReportEntry) {
  return getLedgerEntryDateKey(entry.dueDate, entry.createdAt);
}

function entryDate(entry: ReportEntry) {
  const [year, month, day] = entryDateKey(entry).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Human-readable details cell: description, falling back to a generic label, plus bill reference if present. */
function entryDetails(entry: ReportEntry) {
  const { details } = splitAdjustmentDescription(
    entry.description || (entry.isTransfer ? '' : entry.type === 'YOU_GAVE' ? 'নগদ প্রদান' : 'নগদ গ্রহণ'),
    entry.isTransfer,
    entry.transferPartyName,
  );
  const base = details;
  return entry.billReference ? `${base} (বিল: ${entry.billReference})` : base;
}

function entryAdjustment(entry: ReportEntry) {
  return splitAdjustmentDescription(entry.description, entry.isTransfer, entry.transferPartyName).adjustment;
}

interface MonthGroup {
  key: string;
  label: string;
  entries: ReportEntry[];
  totalDebit: number;
  totalCredit: number;
}

/** Groups ledger entries newest-first by business date, with later-created rows first within a day. */
function groupByMonth(entries: ReportEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  const newestFirst = entries
    .map((entry, index) => ({
      entry,
      index,
      dayKey: entryDateKey(entry),
      createdAt: new Date(entry.createdAt).getTime(),
    }))
    .sort((a, b) =>
      b.dayKey.localeCompare(a.dayKey) ||
      b.createdAt - a.createdAt ||
      b.index - a.index,
    );

  for (const { entry, dayKey } of newestFirst) {
    const date = entryDate(entry);
    const key = dayKey.slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: format(date, 'MMMM yyyy', { locale: bn }), entries: [], totalDebit: 0, totalCredit: 0 };
      groups.push(group);
    }
    group.entries.push(entry);
    if (entry.type === 'YOU_GAVE') {
      group.totalDebit += entry.amount;
    } else {
      group.totalCredit += entry.amount;
    }
  }
  return groups;
}

const COLOR_DEBIT_BG = '#FFF5F5';
const COLOR_CREDIT_BG = '#F0FDF4';
const COLOR_DEBIT_TEXT = '#DC2626';
const COLOR_CREDIT_TEXT = '#16A34A';
const COLOR_BRAND = '#0b3d91';
const GRID_BORDER = '0.75px solid #000000';

/** Balance-column text: signed amount plus the accounting-style Dr/Cr suffix. */
function balanceCell(balanceAfter: number) {
  const isDr = balanceAfter >= 0; // positive = customer owes you (receivable, "Dr"); negative = you owe them ("Cr")
  return `${formatCurrency(Math.abs(balanceAfter))} ${isDr ? 'Dr' : 'Cr'}`;
}

/**
 * Off-screen printable ledger statement, rendered with plain inline styles
 * (no Tailwind utility classes) so html2canvas — which cannot parse the
 * oklch() colors Tailwind v4 emits — can rasterize it reliably into the PDF.
 */
export const LedgerReportDocument = forwardRef<HTMLDivElement, LedgerReportDocumentProps>(
  ({ storeName, party, entries, supportPhone, supportEmail }, ref) => {
    const isGive = party.balanceType === 'YOU_WILL_GIVE';
    const monthGroups = groupByMonth(entries);
    const supportContacts = getPdfSupportContactLinks(supportPhone, supportEmail);

    return (
      <div
        ref={ref}
        style={{
          width: '760px',
          fontFamily: "'Noto Sans Bengali', 'Inter', sans-serif",
          color: '#0f172a',
          backgroundColor: '#ffffff',
        }}
      >
        {/* Top banner: business branding (left) + app identity (right) */}
        <table role="presentation" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', backgroundColor: COLOR_BRAND }}>
          <tbody><tr>
            <td style={{ width: '68%', padding: '12px 24px', verticalAlign: 'middle' }}>
              <h1 style={{ fontSize: `${fitPdfHeaderNameFontSize(storeName, 440, 16)}px`, fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '0.02em', lineHeight: 1.15, whiteSpace: 'nowrap' }}>{storeName}</h1>
            </td>
            <td style={{ width: '32%', padding: '12px 24px', textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
              <span style={{ width: '10px', height: '10px', backgroundColor: '#ffffff', borderRadius: '2px', display: 'inline-block', marginRight: '6px' }} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>Banglakhata</span>
            </td>
          </tr></tbody>
        </table>

        <div style={{ padding: '24px 32px 32px' }}>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 20px' }}>
            রিপোর্ট তৈরির তারিখ: {format(new Date(), 'd MMMM yyyy, hh:mm a', { locale: bn })}
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
              <p style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                কাস্টমার
              </p>
              <p style={{ fontSize: '16px', fontWeight: 800, margin: '2px 0 0' }}>{party.name}</p>
              <p style={{ fontSize: '12px', color: '#475569', margin: '2px 0 0' }}>{party.phone}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                বর্তমান ব্যালেন্স
              </p>
              <p style={{ fontSize: '13px', fontWeight: 800, margin: '4px 0 0', color: isGive ? COLOR_DEBIT_TEXT : COLOR_CREDIT_TEXT }}>
                {isGive ? 'আপনি দেবেন' : 'আপনি পাবেন'}
              </p>
              <p style={{ fontSize: '20px', fontWeight: 800, margin: '2px 0 0', color: isGive ? COLOR_DEBIT_TEXT : COLOR_CREDIT_TEXT }}>
                {formatCurrency(party.currentBalance)}
              </p>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
            <thead>
              <tr style={{ backgroundColor: '#ffffff' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>তারিখ</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ডিটেলস</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>অ্যাডজাস্টমেন্ট</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ডেবিট (-)</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ক্রেডিট (+)</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ব্যালেন্স</th>
              </tr>
            </thead>
            <tbody>
              {monthGroups.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', border: GRID_BORDER }}>
                    এখনো কোনো লেনদেন নেই
                  </td>
                </tr>
              )}
              {monthGroups.map((group, groupIndex) => (
                <Fragment key={group.key}>
                  {/* Month divider: a plain section title (no grid border) that visually
                      separates each month's bordered block, matching the reference layout
                      where every month renders as its own boxed mini-table. */}
                  <tr key={`${group.key}-header`} data-month-key={group.key}>
                    <td
                      colSpan={6}
                      style={{
                        padding: groupIndex === 0 ? '4px 2px 8px' : '18px 2px 8px',
                        color: '#0f172a',
                        fontWeight: 800,
                        fontSize: '13px',
                        border: 'none',
                        backgroundColor: '#ffffff',
                      }}
                    >
                      {group.label}
                    </td>
                  </tr>
                  {group.entries.map((entry, i) => {
                    const isGave = entry.type === 'YOU_GAVE';
                    const imgSrc = billImageSrc(entry.billImage);
                    return (
                      <tr key={entry.id} data-entry-id={entry.id} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                        <td style={{ padding: '7px 10px', border: GRID_BORDER, whiteSpace: 'nowrap' }}>
                          {format(entryDate(entry), 'dd/MM')}
                        </td>
                        <td style={{ padding: '7px 10px', border: GRID_BORDER, color: '#334155' }}>
                          {entryDetails(entry)}
                          {imgSrc && (
                            <BillAttachmentPreview
                              src={imgSrc}
                              alt="বিল"
                              className="block"
                              imageClassName="h-full w-full object-contain"
                              imageStyle={{ width: '48px', height: '48px', objectFit: 'contain' }}
                              style={{ display: 'block', marginTop: '4px', width: '48px', height: '48px' }}
                            />
                          )}
                        </td>
                        <td style={{ padding: '7px 10px', border: GRID_BORDER, color: '#1d4ed8' }}>
                          {entryAdjustment(entry)}
                        </td>
                        <td
                          style={{
                            padding: '7px 10px',
                            border: GRID_BORDER,
                            textAlign: 'right',
                            fontWeight: 700,
                            backgroundColor: COLOR_DEBIT_BG,
                            color: isGave ? COLOR_DEBIT_TEXT : '#cbd5e1',
                          }}
                        >
                          {isGave ? formatCurrency(entry.amount) : ''}
                        </td>
                        <td
                          style={{
                            padding: '7px 10px',
                            border: GRID_BORDER,
                            textAlign: 'right',
                            fontWeight: 700,
                            backgroundColor: COLOR_CREDIT_BG,
                            color: !isGave ? COLOR_CREDIT_TEXT : '#cbd5e1',
                          }}
                        >
                          {!isGave ? formatCurrency(entry.amount) : ''}
                        </td>
                        <td
                          style={{
                            padding: '7px 10px',
                            border: GRID_BORDER,
                            textAlign: 'right',
                            fontWeight: 700,
                            color: entry.balanceAfter >= 0 ? COLOR_DEBIT_TEXT : '#334155',
                          }}
                        >
                          {balanceCell(entry.balanceAfter)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr key={`${group.key}-total`} style={{ backgroundColor: '#f8fafc' }}>
                    <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 800, color: '#0f172a', border: GRID_BORDER }}>
                      {group.label.split(' ')[0]} মোট
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#0f172a', border: GRID_BORDER }}>
                      {formatCurrency(group.totalDebit)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#0f172a', border: GRID_BORDER }}>
                      {formatCurrency(group.totalCredit)}
                    </td>
                    <td style={{ padding: '8px 10px', border: GRID_BORDER }} />
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>

        </div>

        {/* Bottom footer bar: brand CTA (left) + help/legal copy (right). Renders
            once at the true end of the statement content — html2pdf slices a
            single tall canvas into pages, so a bar pinned here cannot repeat on
            every physical page the way "Page X of Y" (stamped separately via
            jsPDF, per page) does. */}
        <table role="presentation" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', backgroundColor: COLOR_BRAND, marginTop: '28px', fontSize: '10px', lineHeight: 1.4 }}>
          <tbody><tr>
            <td style={{ width: '58%', padding: '10px 14px', verticalAlign: 'middle', color: '#ffffff', fontWeight: 700 }}>
              {storeName} থেকে স্বয়ংক্রিয়ভাবে তৈরি করা এই রিপোর্টটি Banglakhata ব্যবহার করে তৈরি।
            </td>
            <td style={{ width: '42%', padding: '8px 14px', verticalAlign: 'middle', textAlign: 'right', color: '#dbeafe', fontSize: '9px' }}>
              {supportContacts.map((contact) => (
                <div key={contact.href} style={{ margin: '0 0 2px', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                  <a href={contact.href} style={{ color: '#dbeafe', textDecoration: 'none', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{contact.label}</a>
                </div>
              ))}
              <div style={{ marginTop: '3px', paddingTop: '3px', borderTop: '1px solid rgba(219,234,254,0.35)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                নিয়ম ও শর্তাবলী প্রযোজ্য
              </div>
            </td>
          </tr></tbody>
        </table>
      </div>
    );
  }
);
LedgerReportDocument.displayName = 'LedgerReportDocument';

/** Builds a portable filename independent of the party's display encoding. */
export function buildReportFilename(_partyName: string) {
  return buildPortablePdfFilename('statement');
}

/**
 * Adds an ASCII "Page X of Y" stamp to every page of a generated jsPDF
 * document. jsPDF's built-in fonts can't render Bengali glyphs, so this
 * overlay is intentionally kept to plain digits/Latin text; all Bengali
 * copy (legal footer, branding) lives in the html2canvas-rendered content
 * instead.
 */
export function stampPageNumbers(pdf: {
  internal: { getNumberOfPages(): number; pageSize: { getWidth(): number; getHeight(): number } };
  setPage(page: number): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  text(text: string, x: number, y: number, options?: { align?: 'left' | 'center' | 'right' }): void;
}) {
  const totalPages = pdf.internal.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Page ${page} of ${totalPages}`, pageWidth - 24, pageHeight - 16, { align: 'right' });
  }
}

/**
 * Normalizes a stored phone number into the digits-only, country-code-prefixed
 * format wa.me requires. Numbers already carrying a country code (leading
 * "+" or 11+ digits) are passed through; bare 10/11-digit local numbers are
 * assumed to be Bangladeshi mobiles and get the 880 country code prefixed.
 */
export function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+') || digits.length >= 12) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `880${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `880${digits}`;
  }
  return digits;
}

export function buildWhatsAppReminderText(storeName: string, party: ReportParty) {
  const isGive = party.balanceType === 'YOU_WILL_GIVE';
  const label = isGive ? 'আপনি দেবেন' : 'আপনি পাবেন';
  return `প্রিয় ${party.name},\n${storeName}-এর হিসাব অনুযায়ী আপনার বর্তমান ব্যালেন্স: ${label} ${formatCurrency(
    party.currentBalance
  )}।\nবিস্তারিত হিসাবের রিপোর্ট (পিডিএফ) সংযুক্ত আছে।\nধন্যবাদান্তে, ${storeName}।`;
}
