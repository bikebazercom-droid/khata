import { forwardRef, Fragment } from 'react';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';
import { billImageSrc } from '@/lib/billImageStorage';

export interface GlobalReportEntry {
  id: string;
  partyId: string;
  partyName: string;
  partyPhone: string;
  type: 'YOU_GAVE' | 'YOU_GOT';
  amount: number;
  description: string;
  billReference: string | null;
  billImage: string | null;
  dueDate: string | null;
  createdAt: string | Date;
}

interface GlobalReportDocumentProps {
  storeName: string;
  periodLabel: string;
  /** Entries must already be sorted oldest -> newest for correct monthly grouping. */
  entries: GlobalReportEntry[];
}

function entryDate(entry: GlobalReportEntry) {
  return new Date(entry.dueDate || entry.createdAt);
}

function entryDetails(entry: GlobalReportEntry) {
  const base = entry.description?.trim() || (entry.type === 'YOU_GAVE' ? 'নগদ প্রদান' : 'নগদ গ্রহণ');
  return entry.billReference ? `${base} (বিল: ${entry.billReference})` : base;
}

interface MonthGroup {
  key: string;
  label: string;
  entries: GlobalReportEntry[];
  totalDebit: number;
  totalCredit: number;
}

/** Groups already chronologically-sorted (oldest -> newest) entries into calendar-month sections. */
function groupByMonth(entries: GlobalReportEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of entries) {
    const date = entryDate(entry);
    const key = format(date, 'yyyy-MM');
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

/**
 * Off-screen printable multi-party transaction statement, rendered with
 * plain inline styles (no Tailwind utility classes) so html2canvas — which
 * cannot parse the oklch() colors Tailwind v4 emits — can rasterize it
 * reliably into the PDF. Unlike the single-party ledger report, entries here
 * span every customer/supplier, so there is no single running balance
 * column; instead each row carries the party's name/phone in the details
 * column and every month closes with a debit/credit subtotal row.
 */
export const GlobalReportDocument = forwardRef<HTMLDivElement, GlobalReportDocumentProps>(
  ({ storeName, periodLabel, entries }, ref) => {
    const monthGroups = groupByMonth(entries);
    const totalDebit = entries.reduce((sum, e) => (e.type === 'YOU_GAVE' ? sum + e.amount : sum), 0);
    const totalCredit = entries.reduce((sum, e) => (e.type === 'YOU_GOT' ? sum + e.amount : sum), 0);
    const netBalance = totalCredit - totalDebit;

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
        <div
          style={{
            backgroundColor: COLOR_BRAND,
            padding: '16px 32px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h1 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '0.02em' }}>{storeName}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', backgroundColor: '#ffffff', borderRadius: '2px', display: 'inline-block' }} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff' }}>ডিজিটাল খাতা</span>
          </div>
        </div>

        <div style={{ padding: '24px 32px 32px' }}>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 4px' }}>
            রিপোর্ট তৈরির তারিখ: {format(new Date(), 'd MMMM yyyy, hh:mm a', { locale: bn })}
          </p>
          <p style={{ fontSize: '13px', fontWeight: 800, margin: '0 0 20px' }}>রিপোর্টের সময়কাল: {periodLabel}</p>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <div style={{ flex: 1, backgroundColor: '#f8fafc', border: GRID_BORDER, borderRadius: '4px', padding: '10px 12px' }}>
              <p style={{ fontSize: '9px', color: '#64748b', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                মোট এন্ট্রি
              </p>
              <p style={{ fontSize: '15px', fontWeight: 800, margin: '2px 0 0' }}>{entries.length}</p>
            </div>
            <div style={{ flex: 1, backgroundColor: COLOR_DEBIT_BG, border: GRID_BORDER, borderRadius: '4px', padding: '10px 12px' }}>
              <p style={{ fontSize: '9px', color: '#64748b', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                আপনি দিয়েছেন
              </p>
              <p style={{ fontSize: '15px', fontWeight: 800, margin: '2px 0 0', color: COLOR_DEBIT_TEXT }}>{formatCurrency(totalDebit)}</p>
            </div>
            <div style={{ flex: 1, backgroundColor: COLOR_CREDIT_BG, border: GRID_BORDER, borderRadius: '4px', padding: '10px 12px' }}>
              <p style={{ fontSize: '9px', color: '#64748b', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                আপনি পেয়েছেন
              </p>
              <p style={{ fontSize: '15px', fontWeight: 800, margin: '2px 0 0', color: COLOR_CREDIT_TEXT }}>{formatCurrency(totalCredit)}</p>
            </div>
            <div style={{ flex: 1, backgroundColor: '#f8fafc', border: GRID_BORDER, borderRadius: '4px', padding: '10px 12px' }}>
              <p style={{ fontSize: '9px', color: '#64748b', fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                মোট ব্যালেন্স
              </p>
              <p style={{ fontSize: '15px', fontWeight: 800, margin: '2px 0 0', color: netBalance >= 0 ? COLOR_CREDIT_TEXT : COLOR_DEBIT_TEXT }}>
                {formatCurrency(Math.abs(netBalance))}
              </p>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
            <thead>
              <tr style={{ backgroundColor: '#ffffff' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>তারিখ</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>কাস্টমার/সাপ্লায়ার</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ডিটেলস</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER, width: '52px' }}>বিল</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ডেবিট (-)</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#0f172a', fontWeight: 800, border: GRID_BORDER }}>ক্রেডিট (+)</th>
              </tr>
            </thead>
            <tbody>
              {monthGroups.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', border: GRID_BORDER }}>
                    এই সময়কালে কোনো লেনদেন নেই
                  </td>
                </tr>
              )}
              {monthGroups.map((group, groupIndex) => (
                <Fragment key={group.key}>
                  <tr key={`${group.key}-header`}>
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
                      <tr key={entry.id} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                        <td style={{ padding: '7px 10px', border: GRID_BORDER, whiteSpace: 'nowrap' }}>
                          {format(entryDate(entry), 'dd/MM')}
                        </td>
                        <td style={{ padding: '7px 10px', border: GRID_BORDER, color: '#0f172a', fontWeight: 700 }}>
                          {entry.partyName}
                          {entry.partyPhone ? (
                            <span style={{ display: 'block', fontSize: '10px', color: '#64748b', fontWeight: 500 }}>{entry.partyPhone}</span>
                          ) : null}
                        </td>
                        <td style={{ padding: '7px 10px', border: GRID_BORDER, color: '#334155' }}>{entryDetails(entry)}</td>
                        <td style={{ padding: '4px 6px', border: GRID_BORDER, textAlign: 'center', width: '52px' }}>
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt="বিল"
                              crossOrigin="anonymous"
                              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '3px', display: 'inline-block' }}
                            />
                          ) : null}
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
                      </tr>
                    );
                  })}
                  <tr key={`${group.key}-total`} style={{ backgroundColor: '#f8fafc' }}>
                    <td colSpan={4} style={{ padding: '8px 10px', fontWeight: 800, color: '#0f172a', border: GRID_BORDER }}>
                      {group.label.split(' ')[0]} মোট
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#0f172a', border: GRID_BORDER }}>
                      {formatCurrency(group.totalDebit)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#0f172a', border: GRID_BORDER }}>
                      {formatCurrency(group.totalCredit)}
                    </td>
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
        <div
          style={{
            backgroundColor: COLOR_BRAND,
            padding: '14px 32px',
            marginTop: '28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
            {storeName} থেকে স্বয়ংক্রিয়ভাবে তৈরি করা এই রিপোর্টটি ডিজিটাল খাতা ব্যবহার করে তৈরি।
          </p>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
              সাহায্যের জন্য {storeName}-এর সাথে যোগাযোগ করুন
            </p>
            <p style={{ fontSize: '9px', color: '#c7d2fe', margin: '2px 0 0' }}>নিয়ম ও শর্তাবলী প্রযোজ্য</p>
          </div>
        </div>
      </div>
    );
  }
);
GlobalReportDocument.displayName = 'GlobalReportDocument';

/** Builds a safe filename for the generated global transaction report PDF. */
export function buildGlobalReportFilename(storeName: string) {
  const safeName = storeName.trim().replace(/\s+/g, '_');
  return `${safeName}_ট্রানজেকশন_রিপোর্ট.pdf`;
}
