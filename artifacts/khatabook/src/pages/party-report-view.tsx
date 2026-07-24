/**
 * Per-party report screen — matches the screenshot layout:
 *   Dark-blue header → date boxes → search + period dropdown
 *   Stats row (মোট ব্যালেন্স + 3-col sub-stats)
 *   Transaction list (3-col: date+balance | debit | credit, alternating row bg)
 *   Footer: [PDF ডাউনলোড] [শেয়ার করুন]
 *
 * PDF is generated ONLY when the user explicitly taps a button.
 */
import { useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ReportPeriodDrawer, type ReportPeriod } from '@/components/modals/report-period-drawer';

// ─── Period helpers ───────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  ALL: 'সব',
  THIS_MONTH: 'এই মাসে',
  SINGLE_DAY: 'এক দিন',
  LAST_WEEK: 'গত সপ্তাহে',
  LAST_MONTH: 'গত মাসের',
  CUSTOM_RANGE: 'তারিখের পরিসর',
};

function resolveDateRange(
  period: ReportPeriod,
  cs: Date | null,
  ce: Date | null,
): { start: Date; end: Date } | null {
  const today = new Date();
  switch (period) {
    case 'ALL':   return null;
    case 'SINGLE_DAY': { const d = cs ?? today; return { start: startOfDay(d), end: endOfDay(d) }; }
    case 'LAST_WEEK':  return { start: startOfDay(subDays(today, 6)), end: endOfDay(today) };
    case 'LAST_MONTH': { const lm = subMonths(today, 1); return { start: startOfMonth(lm), end: endOfMonth(lm) }; }
    case 'THIS_MONTH': return { start: startOfMonth(today), end: endOfMonth(today) };
    case 'CUSTOM_RANGE':
      if (!cs || !ce) return null;
      return { start: startOfDay(cs), end: endOfDay(ce) };
    default: return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PartyReportView() {
  const [, params] = useRoute('/party/:id/report');
  const id = params?.id ?? '';
  const [, navigate] = useLocation();

  const { data: party, isLoading: partyLoading } = useGetParty(id, {
    query: { enabled: !!id, queryKey: getGetPartyQueryKey(id) },
  });
  const { data: allEntries = [], isLoading: entriesLoading } = useListLedgerEntries(id, {
    query: { enabled: !!id, queryKey: getListLedgerEntriesQueryKey(id) },
  });

  const [period,       setPeriod]       = useState<ReportPeriod>('ALL');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [startDate,    setStartDate]    = useState<Date | null>(null);
  const [endDate,      setEndDate]      = useState<Date | null>(null);
  const [search,       setSearch]       = useState('');
  const [isPdfBusy,    setIsPdfBusy]    = useState(false);
  const [isShareBusy,  setIsShareBusy]  = useState(false);

  // Date-filtered entries (all, for totals)
  const dateFiltered = useMemo(() => {
    const range = resolveDateRange(period, startDate, endDate);
    if (!range) return allEntries;
    return allEntries.filter(e => {
      const t = new Date(e.createdAt).getTime();
      return t >= range.start.getTime() && t <= range.end.getTime();
    });
  }, [allEntries, period, startDate, endDate]);

  // Running balance per entry (oldest → newest within date window)
  const runningBalances = useMemo(() => {
    const sorted = [...dateFiltered].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    let bal = 0;
    const map = new Map<string, number>();
    for (const e of sorted) {
      bal += e.type === 'YOU_GAVE' ? e.amount : -e.amount;
      map.set(e.id, bal);
    }
    return map;
  }, [dateFiltered]);

  // Displayed entries: newest-first, filtered by search
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = [...dateFiltered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (!q) return list;
    return list.filter(e => (e.description ?? '').toLowerCase().includes(q));
  }, [dateFiltered, search]);

  // Totals (over full date window, not search-filtered)
  const gave     = useMemo(() => dateFiltered.reduce((s, e) => e.type === 'YOU_GAVE' ? s + e.amount : s, 0), [dateFiltered]);
  const received = useMemo(() => dateFiltered.reduce((s, e) => e.type === 'YOU_GOT'  ? s + e.amount : s, 0), [dateFiltered]);
  const net      = gave - received;
  const isGet    = party ? party.balanceType === 'YOU_WILL_GET' : net > 0;

  // Opening balance = running total of ALL entries BEFORE the current date window.
  // For the "ALL" period this is always zero (no entries precede the window).
  const openingBalance = useMemo(() => {
    const range = resolveDateRange(period, startDate, endDate);
    if (!range) return 0;
    return allEntries
      .filter(e => new Date(e.createdAt).getTime() < range.start.getTime())
      .reduce((s, e) => s + (e.type === 'YOU_GAVE' ? e.amount : -e.amount), 0);
  }, [allEntries, period, startDate, endDate]);

  const loading = partyLoading || entriesLoading;
  const curLbl  = PERIOD_LABELS[period];

  // ── PDF generation ───────────────────────────────────────────────────────────
  // Layout matches the screenshot:
  //   • Navy header bar: party name (left) + "বাংলা খাতা" (right)
  //   • White body: title, date range, 4-col summary, transaction table
  //   • Table columns: তারিখ | ডেবিট(-) | ক্রেডিট(+) | ব্যালেন্স
  //     – YOU_GAVE → ক্রেডিট(+) (party owes you more)
  //     – YOU_GOT  → ডেবিট(-)  (party owes you less)
  //     – running balance shown as "X.XX Cr" or "X.XX Dr"
  //   • Navy footer strip

  const buildPdfHtml = () => {
    const name  = party?.name  ?? '';
    const phone = party?.phone ?? '';
    const now   = new Date();

    // Period label for the PDF sub-heading
    const range = resolveDateRange(period, startDate, endDate);
    const periodStr = (() => {
      if (!range) return 'সকল এন্ট্রি';
      const s = format(range.start, 'd MMMM yyyy', { locale: bn });
      const e = format(range.end,   'd MMMM yyyy', { locale: bn });
      return s === e ? s : `${s} - ${e}`;
    })();

    // Helper: balance → "1,234.00 Cr" / "1,234.00 Dr"
    const fmtBal = (b: number) =>
      `${Math.abs(b).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${b >= 0 ? 'Cr' : 'Dr'}`;

    // Helper: amount → "1,234.00"
    const fmtAmt = (a: number) =>
      a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Build PDF rows: entries sorted oldest→newest, grouped by day.
    // Each date group gets a full-width header row.
    const ascEntries = [...dateFiltered].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    let runBal = openingBalance;
    let tableRows = '';
    let lastDayKey = '';
    let isFirstGroup = true;

    for (const e of ascEntries) {
      const dayKey  = format(new Date(e.createdAt), 'yyyy-MM-dd');
      const isGave  = e.type === 'YOU_GAVE';   // shown in ক্রেডিট(+)
      runBal += isGave ? e.amount : -e.amount;

      // Date group header row
      if (dayKey !== lastDayKey) {
        const dayLabel = format(new Date(e.createdAt), 'd MMMM yyyy', { locale: bn });
        const openingNote = isFirstGroup
          ? ` <span style="font-weight:400;color:#64748b;font-size:11px;">(ওপেনিং ব্যালেন্স: ${fmtBal(openingBalance)})</span>`
          : '';
        tableRows += `<tr style="background:#f1f5f9;">
          <td colspan="4" style="padding:7px 10px;border:1px solid #cbd5e1;font-weight:700;font-size:12px;">${dayLabel}${openingNote}</td>
        </tr>`;
        lastDayKey = dayKey;
        isFirstGroup = false;
      }

      const shortDate = format(new Date(e.createdAt), 'dd/MM');
      const debitCell  = isGave
        ? '<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#fef2f2;"></td>'
        : `<td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;background:#fef2f2;font-size:12px;">${fmtAmt(e.amount)}</td>`;
      const creditCell = isGave
        ? `<td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;background:#f0fdf4;font-size:12px;">${fmtAmt(e.amount)}</td>`
        : '<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#f0fdf4;"></td>';
      const balColor   = runBal >= 0 ? '#166534' : '#991b1b';

      tableRows += `<tr>
        <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;">${shortDate}</td>
        ${debitCell}
        ${creditCell}
        <td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;font-size:12px;font-weight:600;color:${balColor};">${fmtBal(runBal)}</td>
      </tr>`;
    }

    if (!tableRows) {
      tableRows = `<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8;border:1px solid #e2e8f0;">কোনো লেনদেন নেই</td></tr>`;
    }

    // Totals row
    const netColor = net >= 0 ? '#166534' : '#991b1b';
    tableRows += `<tr style="background:#f8fafc;font-weight:700;">
      <td style="padding:8px 10px;border:1px solid #cbd5e1;font-size:12px;">সর্বমোট</td>
      <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;background:#fef2f2;font-size:12px;">${fmtAmt(received)}</td>
      <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;background:#f0fdf4;font-size:12px;">${fmtAmt(gave)}</td>
      <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:${netColor};">${fmtBal(net)}</td>
    </tr>`;

    const timeStr = format(now, 'h:mm a');
    const dateStr = format(now, 'd MMMM yy', { locale: bn });
    const openBalColor = openingBalance >= 0 ? '#166534' : '#991b1b';

    return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans Bengali','Hind Siliguri','Arial',sans-serif;background:#f0f4f8;color:#1e293b}
  .page{background:#fff;width:760px;margin:0 auto;box-shadow:0 2px 12px rgba(0,0,0,.10)}
</style>
</head><body>
<div class="page">

  <!-- ══ 1. Navy Header ══ -->
  <div style="background:#003366;display:flex;justify-content:space-between;align-items:center;padding:14px 22px;color:#fff;">
    <span style="font-size:16px;font-weight:700;">${name}</span>
    <span style="font-size:15px;font-weight:700;">📒 বাংলা খাতা</span>
  </div>

  <!-- ══ 2. White content ══ -->
  <div style="padding:26px 28px;">

    <!-- Title -->
    <div style="text-align:center;margin-bottom:18px;">
      <div style="font-size:18px;font-weight:700;color:#1e293b;">${phone || name} এর স্টেটমেন্ট</div>
      ${phone ? `<div style="font-size:12px;color:#64748b;margin-top:3px;">ফোন নম্বর: ${phone}</div>` : ''}
      <div style="font-size:12px;color:#64748b;margin-top:2px;">(${periodStr})</div>
    </div>

    <!-- 4-col summary -->
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:16px;">
      <tr>
        <td style="padding:12px 14px;border:1px solid #e2e8f0;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">ওপেনিং ব্যালেন্স</div>
          <div style="font-size:15px;font-weight:700;color:${openBalColor};">৳${fmtBal(openingBalance)}</div>
          ${range ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">(on ${format(range.start,'d MMMM yyyy',{locale:bn})})</div>` : ''}
        </td>
        <td style="padding:12px 14px;border:1px solid #e2e8f0;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট খরচ(-)</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">৳${fmtAmt(received)}</div>
        </td>
        <td style="padding:12px 14px;border:1px solid #e2e8f0;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট জমা(+)</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">৳${fmtAmt(gave)}</div>
        </td>
        <td style="padding:12px 14px;border:1px solid #e2e8f0;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট ব্যালেন্স</div>
          <div style="font-size:15px;font-weight:700;color:${netColor};">৳${fmtBal(net)}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;">(${phone || name} ${net >= 0 ? 'পাবে' : 'দেবে'})</div>
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
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:left;font-size:12px;color:#374151;font-weight:700;width:18%;">তারিখ</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;background:#fef2f2;width:26%;">ডেবিট (-)</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;background:#f0fdf4;width:26%;">ক্রেডিট (+)</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;width:30%;">ব্যালেন্স</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <!-- Creation time + page number -->
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:8px;">
      <span>রিপোর্টটি তৈরির সময় : ${timeStr} | ${dateStr}</span>
      <span>Page 1 of 1</span>
    </div>

  </div><!-- /content -->

  <!-- ══ 3. Navy Footer ══ -->
  <div style="background:#003366;color:#fff;padding:12px 22px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span>এখনই বাংলা খাতা ব্যবহার শুরু করুন</span>
      <span style="background:#fff;color:#003366;padding:3px 10px;font-weight:700;border-radius:3px;font-size:11px;">ইনস্টল করুন</span>
    </div>
    <div style="font-size:11px;opacity:0.8;">নিয়ম ও শর্তাবলী প্রযোজ্য</div>
  </div>

</div><!-- /page -->
</body></html>`;
  };

  const generatePdfBlob = async (): Promise<Blob> => {
    // Ensure Noto Sans Bengali (already imported in index.html) is fully
    // loaded before html2canvas captures the off-screen div, so Bengali
    // glyphs render correctly rather than falling back to a box character.
    await Promise.allSettled([
      document.fonts.load('400 14px "Noto Sans Bengali"'),
      document.fonts.load('600 14px "Noto Sans Bengali"'),
      document.fonts.load('700 14px "Noto Sans Bengali"'),
    ]);

    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:#fff;padding-bottom:40px;';
    container.innerHTML = buildPdfHtml();
    document.body.appendChild(container);
    try {
      const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = 210, pdfH = 297;
      const imgH = (canvas.height * pdfW) / canvas.width;
      let yOffset = 0, first = true;
      while (yOffset < imgH) {
        if (!first) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, imgH);
        yOffset += pdfH;
        first = false;
      }
      return pdf.output('blob');
    } finally {
      document.body.removeChild(container);
    }
  };

  const pdfFilename = () =>
    `Banglakhata_${(party?.name ?? 'Report').replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handlePdf = async () => {
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

  const handleShare = async () => {
    setIsShareBusy(true);
    try {
      const blob = await generatePdfBlob();
      const filename = pdfFilename();
      const file = new File([blob], filename, { type: 'application/pdf' });
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

  // ── Render ────────────────────────────────────────────────────────────────────

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

        {/* Date boxes */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {/* Start date */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 bg-white/15 border border-white/30 rounded-xl px-3 py-2.5 text-left w-full active:scale-[0.98] transition-all"
              >
                <CalendarIcon className="w-3.5 h-3.5 text-white/70 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">আরম্ভের তারিখ</p>
                  <p className="text-[12px] font-bold text-white truncate">
                    {startDate ? format(startDate, 'd MMM yyyy', { locale: bn }) : 'নির্বাচন করুন'}
                  </p>
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate ?? undefined}
                onSelect={d => { setStartDate(d ?? null); setPeriod('CUSTOM_RANGE'); }}
              />
            </PopoverContent>
          </Popover>

          {/* End date */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 bg-white/15 border border-white/30 rounded-xl px-3 py-2.5 text-left w-full active:scale-[0.98] transition-all"
              >
                <CalendarIcon className="w-3.5 h-3.5 text-white/70 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-white/60 uppercase tracking-wider">শেষের তারিখ</p>
                  <p className="text-[12px] font-bold text-white truncate">
                    {endDate ? format(endDate, 'd MMM yyyy', { locale: bn }) : 'নির্বাচন করুন'}
                  </p>
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={endDate ?? undefined}
                onSelect={d => { setEndDate(d ?? null); setPeriod('CUSTOM_RANGE'); }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Search bar + period dropdown */}
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
      {/* ══════════════════════════════════════════════════════════════════════ */}

      {/* ══ Scrollable body ══ */}
      <div className="flex-1 overflow-y-auto pb-[80px]">
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="animate-pulse w-8 h-8 rounded-full bg-slate-200" />
          </div>
        ) : (
          <>
            {/* Stats section */}
            <div className="px-4 pt-4 pb-2">
              {/* Row 1: মোট ব্যালেন্স */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-[15px] font-bold text-slate-800">মোট ব্যালেন্স</p>
                <p className={cn('text-[18px] font-extrabold tracking-tight', isGet ? 'text-emerald-600' : 'text-red-600')}>
                  {formatCurrency(Math.abs(net))}
                </p>
              </div>
              <div className="h-px bg-slate-200 mb-3" />
              {/* Row 2: 3-col sub-stats */}
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">মোট</p>
                  <p className="text-[13px] font-extrabold text-slate-800 mt-0.5">{filtered.length} এন্ট্রিগুলো</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">আপনি দিয়েছেন</p>
                  <p className="text-[13px] font-extrabold text-emerald-600 mt-0.5">{formatCurrency(gave)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">আপনি</p>
                  <p className="text-[13px] font-extrabold text-red-600 mt-0.5">{formatCurrency(received)}</p>
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
                    const isGave = entry.type === 'YOU_GAVE';
                    const bal    = runningBalances.get(entry.id) ?? 0;
                    const rowBg  = idx % 2 === 1 ? 'bg-[#FEF2F2]' : 'bg-white';
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          'grid items-center gap-2 px-3 py-3',
                          rowBg,
                          idx < filtered.length - 1 && 'border-b border-slate-100',
                        )}
                        style={{ gridTemplateColumns: '1fr 5rem 5rem' }}
                      >
                        {/* LEFT: date + balance badge */}
                        <div>
                          <p className="text-[13px] font-bold text-slate-800">
                            {format(new Date(entry.createdAt), 'd MMM yy')}
                          </p>
                          <span className="inline-block mt-1 bg-slate-100 text-slate-500 text-[10px] font-semibold px-2 py-0.5 rounded-md">
                            ব্যালেন্স {formatCurrency(Math.abs(bal))}
                          </span>
                        </div>
                        {/* MIDDLE: YOU_GAVE amount (green) */}
                        <div className="text-center">
                          {isGave && (
                            <span className="text-[13px] font-extrabold text-emerald-600">
                              {formatCurrency(entry.amount)}
                            </span>
                          )}
                        </div>
                        {/* RIGHT: YOU_GOT amount (red) */}
                        <div className="text-right">
                          {!isGave && (
                            <span className="text-[13px] font-extrabold text-red-600">
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
        {/* Outline PDF button */}
        <button
          type="button"
          onClick={handlePdf}
          disabled={isPdfBusy || isShareBusy}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-xl border-2 border-[#004B93] text-[#004B93] font-extrabold text-[14px] active:scale-[0.98] transition-all disabled:opacity-60 bg-white"
        >
          {isPdfBusy
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <FileDown className="w-4 h-4" />
          }
          {isPdfBusy ? 'তৈরি হচ্ছে…' : 'PDF ডাউনলোড'}
        </button>
        {/* Filled share button */}
        <button
          type="button"
          onClick={handleShare}
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

      {/* Period drawer */}
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
    </div>
  );
}
