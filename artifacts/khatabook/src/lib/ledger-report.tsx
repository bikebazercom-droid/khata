import { forwardRef } from 'react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';

export interface ReportEntry {
  id: string;
  type: 'YOU_GAVE' | 'YOU_GOT';
  amount: number;
  createdAt: string | Date;
  balanceAfter: number;
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
}

/**
 * Off-screen printable ledger statement, rendered with plain inline styles
 * (no Tailwind utility classes) so html2canvas — which cannot parse the
 * oklch() colors Tailwind v4 emits — can rasterize it reliably into the PDF.
 */
export const LedgerReportDocument = forwardRef<HTMLDivElement, LedgerReportDocumentProps>(
  ({ storeName, party, entries }, ref) => {
    const isGive = party.balanceType === 'YOU_WILL_GIVE';
    // Chronological (oldest -> newest) for a natural statement read order.
    const chronological = [...entries].reverse();

    return (
      <div
        ref={ref}
        style={{
          width: '760px',
          padding: '32px',
          fontFamily: "'Noto Sans Bengali', 'Inter', sans-serif",
          color: '#0f172a',
          backgroundColor: '#ffffff',
        }}
      >
        <div style={{ borderBottom: '3px solid #0b57d0', paddingBottom: '16px', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: '#0b57d0' }}>{storeName}</h1>
          <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0' }}>
            রিপোর্ট তৈরির তারিখ: {format(new Date(), 'd MMM yyyy, hh:mm a')}
          </p>
        </div>

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
            <p style={{ fontSize: '13px', fontWeight: 800, margin: '4px 0 0', color: isGive ? '#dc2626' : '#059669' }}>
              {isGive ? 'আপনি দেবেন' : 'আপনি পাবেন'}
            </p>
            <p style={{ fontSize: '20px', fontWeight: 800, margin: '2px 0 0', color: isGive ? '#dc2626' : '#059669' }}>
              {formatCurrency(party.currentBalance)}
            </p>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#0b57d0' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px', color: '#ffffff', fontWeight: 700 }}>তারিখ ও সময়</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', color: '#ffffff', fontWeight: 700 }}>ধরন</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', color: '#ffffff', fontWeight: 700 }}>পরিমাণ</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', color: '#ffffff', fontWeight: 700 }}>ব্যালেন্স</th>
            </tr>
          </thead>
          <tbody>
            {chronological.map((entry, i) => {
              const isGave = entry.type === 'YOU_GAVE';
              return (
                <tr key={entry.id} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0' }}>
                    {format(new Date(entry.createdAt), 'd MMM yyyy, hh:mm a')}
                  </td>
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0', color: isGave ? '#dc2626' : '#059669', fontWeight: 700 }}>
                    {isGave ? 'দিয়েছেন' : 'পেয়েছেন'}
                  </td>
                  <td
                    style={{
                      padding: '7px 10px',
                      borderBottom: '1px solid #e2e8f0',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: isGave ? '#dc2626' : '#059669',
                    }}
                  >
                    {formatCurrency(entry.amount)}
                  </td>
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', color: '#334155' }}>
                    {formatCurrency(Math.abs(entry.balanceAfter))}
                  </td>
                </tr>
              );
            })}
            {chronological.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#94a3b8' }}>
                  এখনো কোনো লেনদেন নেই
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p style={{ fontSize: '10px', color: '#94a3b8', marginTop: '24px', textAlign: 'center' }}>
          এই রিপোর্টটি {storeName} থেকে স্বয়ংক্রিয়ভাবে তৈরি করা হয়েছে।
        </p>
      </div>
    );
  }
);
LedgerReportDocument.displayName = 'LedgerReportDocument';

/** Builds a safe filename for the generated ledger PDF from a customer name. */
export function buildReportFilename(partyName: string) {
  const safeName = partyName.trim().replace(/\s+/g, '_');
  return `${safeName}_হিসাব_খাতা.pdf`;
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
