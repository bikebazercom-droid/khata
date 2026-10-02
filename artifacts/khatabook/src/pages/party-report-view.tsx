/**
 * Per-party report screen
 *  • Bengali calendar date-picker (custom modal, Bengali numerals)
 *  • "রিপোর্টে অন্তর্ভুক্ত করুন" options sheet before PDF/Share
 *  • Transaction list matching the Khatabook-style screenshot
 */
import { useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  useGetParty,
  useListLedgerEntries,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
} from '@workspace/api-client-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  ChevronLeft,
  Calendar as CalendarIcon,
  Search,
  ChevronDown,
  FileDown,
  Share2,
  Loader2,
  Check,
} from 'lucide-react';
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
} from 'date-fns';
import { bn } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatCurrency, cn } from '@/lib/utils';
import { BengaliCalendarModal } from '@/components/modals/bengali-calendar-modal';
import { formatBengaliDateInput } from '@/lib/bengali-date';
import { ReportPeriodDrawer, type ReportPeriod } from '@/components/modals/report-period-drawer';
import { getLedgerEntryDateKey } from '@/lib/date-time';
import {
  buildPartyStatementRows,
  calculatePartyStatementSummary,
  filterPartyStatementEntriesByRange,
} from '@/lib/party-statement';

// ─── Report Options Bottom Sheet ──────────────────────────────────────────────

function ReportOptionsSheet({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (includeDetailed: boolean) => void;
}) {
  const [includeDetailed, setIncludeDetailed] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl w-full max-w-lg px-5 pt-5 pb-[calc(1.5rem+var(--safe-bottom))] shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-5" />

        <p className="text-[#004B93] font-bold text-[16px] mb-4">রিপোর্টে অন্তর্ভুক্ত করুন</p>

        {/* Checkbox row */}
        <button
          type="button"
          onClick={() => setIncludeDetailed(v => !v)}
          className="flex items-center gap-3 py-3 w-full text-left active:opacity-70 transition-opacity"
        >
          <div
            className={cn(
              'w-5 h-5 border-2 rounded flex items-center justify-center shrink-0 transition-colors',
              includeDetailed ? 'bg-[#004B93] border-[#004B93]' : 'border-slate-400 bg-white'
            )}
          >
            {includeDetailed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
          <span className="text-[15px] text-slate-800 font-medium">বিস্তারিত প্রবেশিকা</span>
        </button>

        <div className="h-px bg-slate-100 my-3" />

        <button
          type="button"
          onClick={() => onConfirm(includeDetailed)}
          className="w-full h-12 bg-[#004B93] text-white rounded-xl font-bold text-[15px] active:opacity-90 transition-opacity mt-2"
        >
          ঠিক আছে
        </button>
      </div>
    </div>
  );
}

// ─── Period helpers ───────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  ALL: 'সব',
  THIS_MONTH: 'এই মাসে',
  SINGLE_DAY: 'এক দিন',
  LAST_WEEK: 'গত সপ্তাহে',
  LAST_MONTH: 'গত মাসের',
  CUSTOM_RANGE: 'তারিখের পরিসর',
};

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function resolveDateRange(
  period: ReportPeriod,
  cs: Date | null,
  ce: Date | null,
): { start: Date; end: Date } | null {
  const today = new Date();
  switch (period) {
    case 'ALL':   return null;
    case 'SINGLE_DAY': {
      const d = cs ?? today;
      return { start: startOfDay(d), end: endOfDay(d) };
    }
    case 'LAST_WEEK':
      return { start: startOfDay(subDays(today, 6)), end: endOfDay(today) };
    case 'LAST_MONTH': {
      const lm = subMonths(today, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm) };
    }
    case 'THIS_MONTH':
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case 'CUSTOM_RANGE':
      if (!cs || !ce) return null;
      return { start: startOfDay(cs), end: endOfDay(ce) };
    default: return null;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PartyReportView() {
  const [, params]    = useRoute('/party/:id/report');
  const id            = params?.id ?? '';
  const [, navigate]  = useLocation();
  const { selectedBusinessId } = useBusinessContext();

  const { data: party,      isLoading: partyLoading   } = useGetParty(id, {
    query: { enabled: !!id, queryKey: businessScopedQueryKey(getGetPartyQueryKey(id), selectedBusinessId) },
  });
  const { data: allEntries = [], isLoading: entriesLoading } = useListLedgerEntries(id, {
    query: { enabled: !!id, queryKey: businessScopedQueryKey(getListLedgerEntriesQueryKey(id), selectedBusinessId) },
  });

  // ── UI state ──
  const [period,        setPeriod]        = useState<ReportPeriod>('ALL');
  const [isPeriodOpen,  setIsPeriodOpen]  = useState(false);
  const [startDate,     setStartDate]     = useState<Date | null>(null);
  const [endDate,       setEndDate]       = useState<Date | null>(null);
  const [search,        setSearch]        = useState('');

  // Calendar modal: 'start' | 'end' | null
  const [calendarFor,   setCalendarFor]   = useState<'start' | 'end' | null>(null);

  // Options sheet: which action is pending
  const [pendingAction, setPendingAction] = useState<'pdf' | 'share' | null>(null);

  // Busy flags
  const [isPdfBusy,   setIsPdfBusy]   = useState(false);
  const [isShareBusy, setIsShareBusy] = useState(false);

  // ── Data ──
  const reportRange = useMemo(
    () => resolveDateRange(period, startDate, endDate),
    [period, startDate, endDate],
  );

  const dateFiltered = useMemo(
    () => filterPartyStatementEntriesByRange(allEntries, reportRange),
    [allEntries, reportRange],
  );

  const statementSummary = useMemo(() => calculatePartyStatementSummary({
    allEntries,
    statementEntries: dateFiltered,
    currentBalance: party?.currentBalance ?? 0,
    balanceType: party?.balanceType ?? 'YOU_WILL_GET',
    periodStart: reportRange?.start ?? null,
  }), [allEntries, dateFiltered, party, reportRange]);
  const { openingBalance, totalDebit, totalCredit, closingBalance } = statementSummary;
  const isGet = closingBalance >= 0;

  const runningBalances = useMemo(() => {
    const sorted = [...dateFiltered].sort(
      (a, b) =>
        getLedgerEntryDateKey(a.dueDate, a.createdAt).localeCompare(getLedgerEntryDateKey(b.dueDate, b.createdAt)) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    // Start from opening balance so the badge always shows the real
    // cumulative balance (matching the Khatabook-style screenshot).
    let bal = openingBalance;
    const map = new Map<string, number>();
    for (const e of sorted) {
      bal += e.type === 'YOU_GAVE' ? e.amount : -e.amount;
      map.set(e.id, bal);
    }
    return map;
  }, [dateFiltered, openingBalance]);

  const filtered = useMemo(() => {
    const q    = search.toLowerCase().trim();
    const list = [...dateFiltered].sort(
      (a, b) =>
        getLedgerEntryDateKey(b.dueDate, b.createdAt).localeCompare(getLedgerEntryDateKey(a.dueDate, a.createdAt)) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (!q) return list;
    return list.filter(e => (e.description ?? '').toLowerCase().includes(q));
  }, [dateFiltered, search]);

  const loading = partyLoading || entriesLoading;
  const curLbl  = PERIOD_LABELS[period];

  // ── PDF generation ────────────────────────────────────────────────────────

  const buildPdfHtml = () => {
    const name  = party?.name  ?? '';
    const phone = party?.phone ?? '';
    const safeName = escapeHtml(name);
    const safePhone = escapeHtml(phone);
    const now   = new Date();

    const range     = reportRange;
    const periodStr = (() => {
      if (!range) return 'সকল এন্ট্রি';
      const s = format(range.start, 'd MMMM yyyy', { locale: bn });
      const e = format(range.end,   'd MMMM yyyy', { locale: bn });
      return s === e ? s : `${s} - ${e}`;
    })();

    // Plain amount — no currency symbol (used inside table cells)
    const fmtAmt = (a: number) =>
      Math.abs(a).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Balance with Dr/Cr suffix:
    //   positive = party owes you (Dr — party is debited)
    //   negative = you owe party (Cr — party is credited)
    const fmtBal = (b: number) =>
      `${fmtAmt(b)} ${b >= 0 ? 'Dr' : 'Cr'}`;
    const balClr = (b: number) => b >= 0 ? '#b91c1c' : '#166534';

    const statementRows = buildPartyStatementRows(dateFiltered, openingBalance);
    let tableRows = '';
    let lastDayKey = '';
    const openingBalanceDayKey = statementRows[0]?.dayKey;

    for (const row of statementRows) {
      if (row.dayKey !== lastDayKey) {
        // In chronological order, the opening balance belongs to the first group.
        const openNote = row.dayKey === openingBalanceDayKey
          ? `<td style="border:0;text-align:right;font-weight:400;color:#64748b;font-size:11px;white-space:nowrap;">(ওপেনিং ব্যালেন্স: ${fmtBal(openingBalance)})</td>`
          : '<td style="border:0;"></td>';
        tableRows += `<tr style="background:#f1f5f9;">
          <td colspan="5" style="padding:0;border:1px solid #cbd5e1;">
            <table style="width:100%;border-collapse:collapse;"><tr>
              <td style="border:0;padding:7px 10px;font-weight:700;font-size:12px;">${row.dayLabel}</td>
              ${openNote}
            </tr></table>
          </td>
        </tr>`;
        lastDayKey   = row.dayKey;
      }

      const details = escapeHtml(row.details);
      const debitCell  = row.debit !== null
        ? `<td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;background:#fef2f2;font-size:12px;">${fmtAmt(row.debit)}</td>`
        : '<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#fef2f2;"></td>';
      const creditCell = row.credit !== null
        ? `<td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;background:#f0fdf4;font-size:12px;">${fmtAmt(row.credit)}</td>`
        : '<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#f0fdf4;"></td>';

      tableRows += `<tr>
        <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:11px;white-space:nowrap;">${row.dateTime}</td>
        <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:11px;word-break:break-word;">${details}</td>
        ${debitCell}
        ${creditCell}
        <td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;font-size:12px;font-weight:600;color:${balClr(row.balanceAfter)};white-space:nowrap;">${fmtBal(row.balanceAfter)}</td>
      </tr>`;
    }

    if (!tableRows) {
      tableRows = `<tr><td colspan="5" style="padding:16px;text-align:center;color:#94a3b8;border:1px solid #e2e8f0;">কোনো লেনদেন নেই</td></tr>`;
    }

    // YOU_GAVE entries are debits; YOU_GOT entries are credits.
    tableRows += `<tr style="background:#f8fafc;font-weight:700;">
      <td colspan="2" style="padding:8px 10px;border:1px solid #cbd5e1;font-size:12px;">সর্বমোট</td>
      <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;background:#fef2f2;font-size:12px;">${fmtAmt(totalDebit)}</td>
      <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;background:#f0fdf4;font-size:12px;">${fmtAmt(totalCredit)}</td>
      <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:${balClr(closingBalance)};">${fmtBal(closingBalance)}</td>
    </tr>`;

    const timeStr  = format(now, 'h:mm a');
    const dateDay  = format(now, 'd', { locale: bn });
    const dateMon  = format(now, 'MMMM', { locale: bn });
    const dateYr   = format(now, 'yy');
    const dateStr  = `${dateDay} ${dateMon}'${dateYr}`;

    const openBalClr    = balClr(openingBalance);
    const netClr        = balClr(closingBalance);
    const partyRelation = closingBalance >= 0 ? `${safeName} দেবে` : `${safeName} পাবে`;

    return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans Bengali',sans-serif;background:#e8ecf1;color:#1e293b;padding:24px 0 40px}
  .page{background:#fff;width:740px;margin:0 auto;box-shadow:0 2px 16px rgba(0,0,0,.15)}
</style>
</head><body>
<div class="page">

  <!-- Header -->
  <div style="background:#003366;display:flex;justify-content:space-between;align-items:center;padding:14px 22px;color:#fff;">
    <span style="font-size:16px;font-weight:700;">${safeName}</span>
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:20px;">📒</span>
      <span style="font-size:15px;font-weight:700;">বাংলা খাতা</span>
    </div>
  </div>

  <!-- Body -->
  <div style="padding:26px 28px;">

    <!-- Title -->
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:18px;font-weight:700;color:#1e293b;">${safeName} এর স্টেটমেন্ট</div>
      ${phone ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">ফোন নম্বর: ${safePhone}</div>` : ''}
      <div style="font-size:12px;color:#64748b;margin-top:3px;">(${periodStr})</div>
    </div>

    <!-- Summary box -->
    <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;margin-bottom:18px;">
      <tr>
        <td style="padding:12px 14px;border-right:1px solid #cbd5e1;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">ওপেনিং ব্যালেন্স</div>
          <div style="font-size:15px;font-weight:700;color:${openBalClr};">৳${fmtBal(openingBalance)}</div>
          ${range ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">(on ${format(range.start,'d MMMM yyyy',{locale:bn})})</div>` : ''}
        </td>
        <td style="padding:12px 14px;border-right:1px solid #cbd5e1;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট ডেবিট / খরচ (-)</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">৳${fmtAmt(totalDebit)}</div>
        </td>
        <td style="padding:12px 14px;border-right:1px solid #cbd5e1;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট ক্রেডিট / জমা (+)</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">৳${fmtAmt(totalCredit)}</div>
        </td>
        <td style="padding:12px 14px;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট ব্যালেন্স</div>
          <div style="font-size:15px;font-weight:700;color:${netClr};">৳${fmtBal(closingBalance)}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;">(${partyRelation})</div>
        </td>
      </tr>
    </table>

    <!-- Entry count -->
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#374151;">
      এন্ট্রির সংখ্যা: ${dateFiltered.length} (${curLbl})
    </div>

    <!-- Transaction table -->
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:left;font-size:12px;color:#374151;font-weight:700;width:24%;">তারিখ</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:left;font-size:12px;color:#374151;font-weight:700;width:26%;">ডিটেইলস</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;background:#fef2f2;width:16%;">ডেবিট / খরচ (-)</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;background:#f0fdf4;width:16%;">ক্রেডিট / জমা (+)</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;width:18%;">ব্যালেন্স (Dr/Cr)</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <!-- Footer line -->
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:6px;">
      <span>রিপোর্ট তৈরি হয়েছে : ${timeStr} | ${dateStr}</span>
      <span>Page 1 of 1</span>
    </div>

  </div>

  <!-- Bottom banner -->
  <div style="background:#003366;color:#fff;padding:12px 22px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span>এখনই বাংলা খাতা ব্যবহার শুরু করুন</span>
      <span style="background:#fff;color:#003366;padding:3px 10px;font-weight:700;border-radius:3px;font-size:11px;">ইনস্টল করুন</span>
    </div>
    <div style="text-align:right;font-size:11px;opacity:0.85;">
      ${phone ? `📞 ${safePhone}` : ''}<br/>নিয়ম ও শর্তাবলী প্রযোজ্য
    </div>
  </div>

</div>
</body></html>`;
  };

  const generatePdfBlob = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText =
        'position:fixed;left:-9999px;top:0;width:820px;height:1200px;border:none;visibility:hidden;';
      document.body.appendChild(iframe);

      const cleanup = () => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      };

      iframe.onload = async () => {
        try {
          const iframeDoc = iframe.contentDocument!;

          // 1. Wait for the iframe's font-loading queue to settle
          await iframeDoc.fonts.ready;

          // 2. Explicitly request every weight used in the PDF
          await Promise.allSettled([
            iframeDoc.fonts.load('400 16px "Noto Sans Bengali"'),
            iframeDoc.fonts.load('600 16px "Noto Sans Bengali"'),
            iframeDoc.fonts.load('700 16px "Noto Sans Bengali"'),
            iframeDoc.fonts.load('900 16px "Noto Sans Bengali"'),
          ]);

          // 3. Verify the font actually loaded (CDN might be slow/blocked).
          //    If it hasn't loaded yet, wait up to 3 s more before capturing.
          const bengaliReady = iframeDoc.fonts.check('700 16px "Noto Sans Bengali"');
          await new Promise(r => setTimeout(r, bengaliReady ? 200 : 3000));

          const canvas  = await html2canvas(iframeDoc.body, {
            scale: 2, useCORS: true, allowTaint: true,
            backgroundColor: '#e8ecf1', logging: false, windowWidth: 820,
          });
          const imgData = canvas.toDataURL('image/jpeg', 0.95);
          const pdf     = new jsPDF('p', 'mm', 'a4');
          const pdfW = 210, pdfH = 297;
          const imgH    = (canvas.height * pdfW) / canvas.width;
          let yOffset = 0, first = true;
          while (yOffset < imgH) {
            if (!first) pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, imgH);
            yOffset += pdfH;
            first = false;
          }
          resolve(pdf.output('blob'));
        } catch (err) {
          reject(err);
        } finally {
          cleanup();
        }
      };
      iframe.onerror = e => { cleanup(); reject(e); };

      const doc = iframe.contentDocument!;
      doc.open(); doc.write(buildPdfHtml()); doc.close();
    });

  const pdfFilename = () =>
    `Banglakhata_${(party?.name ?? 'Report').replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const executePdf = async () => {
    setIsPdfBusy(true);
    try {
      const blob = await generatePdfBlob();
      triggerDownload(blob, pdfFilename());
      toast.success('PDF ডাউনলোড হয়েছে');
    } catch (err) {
      console.error(err);
      toast.error('PDF তৈরি করতে সমস্যা হয়েছে।');
    } finally {
      setIsPdfBusy(false);
    }
  };

  const executeShare = async () => {
    setIsShareBusy(true);
    try {
      const blob     = await generatePdfBlob();
      const filename = pdfFilename();
      const file     = new File([blob], filename, { type: 'application/pdf' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${party?.name ?? ''} এর রিপোর্ট` });
      } else {
        triggerDownload(blob, filename);
        toast.success('PDF ডাউনলোড হয়েছে');
      }
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        console.error(err);
        toast.error('শেয়ার করতে সমস্যা হয়েছে।');
      }
    } finally {
      setIsShareBusy(false);
    }
  };

  // Options sheet confirm
  const handleOptionsConfirm = (_includeDetailed: boolean) => {
    setPendingAction(null);
    if (pendingAction === 'pdf')   executePdf();
    if (pendingAction === 'share') executeShare();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full bg-[#f8fafc]">

      {/* ══ Dark-blue header zone ══ */}
      <div className="shrink-0 bg-[#004B93] px-4 pb-4 pt-[calc(1rem+var(--safe-top))] z-10">

        {/* Title row */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(`/party/${id}`)}
            className="text-white active:opacity-70 transition-opacity shrink-0"
            aria-label="ফিরে যান"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-white font-extrabold text-[17px] tracking-tight flex-1 truncate">
            {partyLoading ? 'লোড হচ্ছে…' : `${party?.name ?? ''} এর রিপোর্ট`}
          </h1>
        </div>

        {/* Date boxes — open Bengali calendar on tap */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => setCalendarFor('start')}
            className={cn(
              'flex items-center gap-2 bg-white/15 border rounded-xl px-3 py-2.5 text-left w-full active:scale-[0.98] transition-all',
              startDate ? 'border-white/60' : 'border-white/30',
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5 text-white/70 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">আরম্ভের তারিখ</p>
              <p className={cn('text-[12px] font-bold truncate', startDate ? 'text-white' : 'text-white/50')}>
                {startDate ? formatBengaliDateInput(startDate) : 'নির্বাচন করুন'}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setCalendarFor('end')}
            className={cn(
              'flex items-center gap-2 bg-white/15 border rounded-xl px-3 py-2.5 text-left w-full active:scale-[0.98] transition-all',
              endDate ? 'border-white/60' : 'border-white/30',
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5 text-white/70 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">শেষের তারিখ</p>
              <p className={cn('text-[12px] font-bold truncate', endDate ? 'text-white' : 'text-white/50')}>
                {endDate ? formatBengaliDateInput(endDate) : 'নির্বাচন করুন'}
              </p>
            </div>
          </button>
        </div>

        {/* Search + period dropdown */}
        <div className="flex items-center bg-white/15 border border-white/25 rounded-xl overflow-hidden">
          <Search className="w-4 h-4 text-white/60 ml-3 shrink-0" />
          <input
            type="text"
            placeholder="এন্ট্রি অনুসন্ধান করুন"
            className="flex-1 bg-transparent text-white placeholder-white/50 text-[13px] font-medium py-2.5 px-2 outline-none"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setIsPeriodOpen(true)}
            className="flex items-center gap-1 px-3 py-2.5 border-l border-white/25 text-white font-bold text-[13px] shrink-0 active:opacity-70 transition-opacity"
          >
            {curLbl}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ══ Scrollable body ══ */}
      <div className="flex-1 overflow-y-auto pb-[80px]">
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="animate-pulse w-8 h-8 rounded-full bg-slate-200" />
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[15px] font-bold text-slate-800">মোট ব্যালেন্স</p>
                <p className={cn('text-[18px] font-extrabold tracking-tight', isGet ? 'text-emerald-600' : 'text-red-600')}>
                  {formatCurrency(Math.abs(closingBalance))}
                </p>
              </div>
              <div className="h-px bg-slate-200 mb-3" />
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">মোট</p>
                  <p className="text-[13px] font-extrabold text-slate-800 mt-0.5">{filtered.length} এন্ট্রিগুলো</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">আপনি দিয়েছেন</p>
                  <p className="text-[13px] font-extrabold text-red-600 mt-0.5">{formatCurrency(totalDebit)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">আপনি পেয়েছেন</p>
                  <p className="text-[13px] font-extrabold text-emerald-600 mt-0.5">{formatCurrency(totalCredit)}</p>
                </div>
              </div>
            </div>

            {/* Transaction list */}
            <div className="px-4 mt-3">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-center">
                  <p className="text-sm font-medium">
                    {search.trim() ? 'কোনো মিল পাওয়া যায়নি' : 'এই সময়কালে কোনো লেনদেন নেই'}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl overflow-hidden border border-slate-100 bg-white shadow-sm mb-4">
                  {filtered.map((entry, idx) => {
                    // YOU_GAVE = debit (you gave); YOU_GOT = credit (you received).
                    const isDebit  = entry.type === 'YOU_GAVE';
                    const bal      = runningBalances.get(entry.id) ?? 0;
                    const isLast   = idx === filtered.length - 1;
                    const [year, month, day] = getLedgerEntryDateKey(entry.dueDate, entry.createdAt).split('-').map(Number);
                    const businessDate = new Date(year, month - 1, day);
                    return (
                      <div
                        key={entry.id}
                        className={cn('grid', !isLast && 'border-b border-slate-100')}
                        style={{ gridTemplateColumns: '1fr 5.5rem 5.5rem' }}
                      >
                        {/* Col 1: date + running balance — always white */}
                        <div className="bg-white px-3 py-3">
                          <p className="text-[13px] font-bold text-slate-800">
                            {format(businessDate, 'd MMM yy')}
                          </p>
                          <p className={cn(
                            'text-[11px] font-semibold mt-0.5',
                            bal >= 0 ? 'text-emerald-600' : 'text-red-500',
                          )}>
                            ব্যালেন্স: {formatCurrency(Math.abs(bal))}
                          </p>
                        </div>

                        {/* Col 2: debit amount — always pink bg, amount shown only for YOU_GAVE */}
                        <div className="bg-[#FEF2F2] flex items-center justify-end px-3 py-3">
                          {isDebit && (
                            <span className="text-[13px] font-extrabold text-red-600">
                              {formatCurrency(entry.amount)}
                            </span>
                          )}
                        </div>

                        {/* Col 3: credit amount — always white bg, amount shown only for YOU_GOT */}
                        <div className="bg-white flex items-center justify-end px-3 py-3">
                          {!isDebit && (
                            <span className="text-[13px] font-extrabold text-emerald-600">
                              {formatCurrency(entry.amount)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ══ Sticky footer buttons ══ */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pt-3 pb-[calc(0.75rem+var(--safe-bottom))] bg-white border-t border-slate-200 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] z-20 flex gap-3">
        <button
          type="button"
          onClick={() => setPendingAction('pdf')}
          disabled={isPdfBusy || isShareBusy}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl border-2 border-[#004B93] text-[#004B93] font-extrabold text-[14px] active:scale-[0.98] transition-all disabled:opacity-60 bg-white"
        >
          {isPdfBusy
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <FileDown className="w-4 h-4" />
          }
          {isPdfBusy ? 'তৈরি হচ্ছে…' : 'PDF ডাউনলোড'}
        </button>
        <button
          type="button"
          onClick={() => setPendingAction('share')}
          disabled={isPdfBusy || isShareBusy}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl bg-[#004B93] text-white font-extrabold text-[14px] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {isShareBusy
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Share2 className="w-4 h-4" />
          }
          {isShareBusy ? 'তৈরি হচ্ছে…' : 'শেয়ার করুন'}
        </button>
      </div>

      {/* ══ Period drawer ══ */}
      <ReportPeriodDrawer
        open={isPeriodOpen}
        onOpenChange={setIsPeriodOpen}
        value={period}
        onSelect={p => {
          setPeriod(p);
          if (p !== 'CUSTOM_RANGE' && p !== 'SINGLE_DAY') {
            setStartDate(null);
            setEndDate(null);
          }
        }}
      />

      {/* ══ Bengali Calendar Modal ══ */}
      {calendarFor === 'start' && (
        <BengaliCalendarModal
          value={startDate}
          onConfirm={d => { setStartDate(d); setPeriod('CUSTOM_RANGE'); setCalendarFor(null); }}
          onCancel={() => setCalendarFor(null)}
          onClear={() => { setStartDate(null); setCalendarFor(null); }}
        />
      )}
      {calendarFor === 'end' && (
        <BengaliCalendarModal
          value={endDate}
          onConfirm={d => { setEndDate(d); setPeriod('CUSTOM_RANGE'); setCalendarFor(null); }}
          onCancel={() => setCalendarFor(null)}
          onClear={() => { setEndDate(null); setCalendarFor(null); }}
        />
      )}

      {/* ══ Report Options Sheet ══ */}
      <ReportOptionsSheet
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        onConfirm={handleOptionsConfirm}
      />

    </div>
  );
}
