import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  useListGlobalLedgerEntries,
  getListGlobalLedgerEntriesQueryKey,
  useGetBusinessSettings,
  getGetBusinessSettingsQueryKey,
  PartyRole,
} from '@workspace/api-client-react';
import {
  buildGlobalLedgerReportQuery,
  calculateGlobalLedgerReportTotals,
} from '@workspace/api-client-react/global-ledger-report';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ChevronLeft, Calendar as CalendarIcon, Search, ChevronDown, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { BengaliCalendarModal } from '@/components/modals/bengali-calendar-modal';
import { formatBengaliDateInput } from '@/lib/bengali-date';
import { ReportPeriodDrawer, type ReportPeriod } from '@/components/modals/report-period-drawer';
import { BillImageLightbox } from '@/components/modals/bill-image-lightbox';
import { billImageSrc } from '@/lib/billImageStorage';
import { loadShopProfile } from '@/components/modals/settings-drawer';
import { buildGlobalLedgerReportCsv } from '@/lib/global-ledger-report-csv';
import {
  sortGlobalLedgerEntriesChronologically,
  sortGlobalLedgerEntriesNewestFirst,
} from '@/lib/global-ledger-report-order';
import { filterGlobalLedgerEntriesByRole } from '@/lib/global-ledger-report-role';
import { formatLedgerEntryDateTime } from '@/lib/date-time';

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  ALL: 'সব',
  THIS_MONTH: 'এই মাসে',
  SINGLE_DAY: 'এক দিন',
  LAST_WEEK: 'গত সপ্তাহে',
  LAST_MONTH: 'গত মাসের',
  CUSTOM_RANGE: 'তারিখের পরিসর',
};

export function ReportView() {
  const [, navigate] = useLocation();
  const { selectedBusinessId } = useBusinessContext();

  // useSearch() uses useSyncExternalStore and can produce a stale snapshot in
  // React 18 concurrent mode before the pushState event is committed.
  // Reading window.location.search directly is always ground-truth — pushState
  // already ran before React rendered this component.
  // useLocation() is kept solely as a reactive trigger: if the URL changes
  // while the component stays mounted, it will re-render and re-read the search.
  const [_currentPath] = useLocation(); // reactive trigger — value intentionally unused
  const roleParam = new URLSearchParams(window.location.search).get('role') ?? 'customer';
  const isSupplier = roleParam === 'supplier';
  const partyRole = isSupplier ? PartyRole.SUPPLIER : PartyRole.CUSTOMER;
  const roleLabel = isSupplier ? 'সরবরাহকারী' : 'গ্রাহক';

  const { data: settings } = useGetBusinessSettings({
    query: { queryKey: businessScopedQueryKey(getGetBusinessSettingsQueryKey(), selectedBusinessId) },
  });

  const [period, setPeriod] = useState<ReportPeriod>('ALL');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [calendarFor, setCalendarFor] = useState<'start' | 'end' | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      ...buildGlobalLedgerReportQuery(period, startDate, endDate, search),
      partyRole,
    }),
    [period, startDate, endDate, search, partyRole],
  );
  const { data: unsortedEntries = [], isLoading } = useListGlobalLedgerEntries(params, {
    query: {
      queryKey: businessScopedQueryKey(getListGlobalLedgerEntriesQueryKey(params), selectedBusinessId),
    }
  });
  const entries = useMemo(
    () => sortGlobalLedgerEntriesNewestFirst(
      filterGlobalLedgerEntriesByRole(unsortedEntries, partyRole),
    ),
    [unsortedEntries, partyRole],
  );

  const { totalDebit, totalCredit, netBalance } = useMemo(
    () => calculateGlobalLedgerReportTotals(entries),
    [entries],
  );

  const periodLabel = useMemo(() => {
    if (period === 'CUSTOM_RANGE' && startDate && endDate)
      return `${format(startDate, 'd MMM yyyy', { locale: bn })} - ${format(endDate, 'd MMM yyyy', { locale: bn })}`;
    if (period === 'SINGLE_DAY' && startDate)
      return format(startDate, 'd MMMM yyyy', { locale: bn });
    return PERIOD_LABELS[period];
  }, [period, startDate, endDate]);

  // ── HTML-to-canvas PDF (browser shapes Bengali natively) ─────────────────
  const handleDownload = async () => {
    setIsGenerating(true);
    const shopProfile = loadShopProfile();
    const storeName  = shopProfile.businessName || settings?.storeName || 'Banglakhata';
    const dateStr    = new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr    = new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true });
    const footerAddress = shopProfile.address || '';
    const footerPhone   = shopProfile.phone   || '';

    const pdfEntries = sortGlobalLedgerEntriesChronologically(entries);
    const rowsHtml = pdfEntries.map(e => {
      const isGave   = e.type === 'YOU_GAVE';
      const dateCell = formatLedgerEntryDateTime(e.dueDate, e.createdAt);
      const debitCell  = isGave
        ? `<td style="padding:10px;border:1px solid #000;text-align:right;background:#FEF2F2;color:#000;font-weight:500;">৳${e.amount.toFixed(2)}</td>`
        : `<td style="padding:10px;border:1px solid #000;background:#FEF2F2;"></td>`;
      const creditCell = !isGave
        ? `<td style="padding:10px;border:1px solid #000;text-align:right;background:#F0FDF4;color:#000;font-weight:500;">৳${e.amount.toFixed(2)}</td>`
        : `<td style="padding:10px;border:1px solid #000;background:#F0FDF4;"></td>`;
      return `
        <tr style="vertical-align:top;">
          <td style="padding:10px;border:1px solid #000;color:#000;">${dateCell}</td>
          <td style="padding:10px;border:1px solid #000;font-weight:500;word-break:break-word;">${e.partyName || '—'}</td>
          <td style="padding:10px;border:1px solid #000;word-break:break-word;">${e.description || '—'}</td>
          ${debitCell}
          ${creditCell}
        </tr>`;
    }).join('');

    const container = document.createElement('div');
    container.style.cssText = [
      'position:absolute', 'left:-9999px', 'top:0', 'width:794px',
      'background:#fff', "font-family:'Noto Sans Bengali','Hind Siliguri',sans-serif",
      'padding-bottom:40px',
    ].join(';');

    container.innerHTML = `
      <!-- 1. Top Navy Header -->
      <div style="background:#003366;display:flex;justify-content:space-between;align-items:center;padding:16px 24px;color:#fff;font-size:20px;font-weight:bold;box-sizing:border-box;">
        <span>${storeName}</span>
        <span style="letter-spacing:0.5px;">📘 Banglakhata</span>
      </div>

      <div style="padding:30px;box-sizing:border-box;">
        <!-- 2. Title -->
        <div style="text-align:center;margin-bottom:25px;">
          <div style="font-size:24px;font-weight:bold;color:#000;letter-spacing:0.5px;">অ্যাকাউন্টের স্টেটমেন্ট</div>
          <div style="font-size:15px;color:#555;font-weight:500;margin-top:6px;">${periodLabel} | ${dateStr}</div>
        </div>

        <!-- 3. Summary Cards -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:25px;text-align:center;border:1px solid #E5E7EB;">
          <tr>
            <td style="width:33.33%;padding:16px;border-right:1px solid #E5E7EB;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">মোট খরচ(-)</div>
              <div style="font-size:18px;font-weight:bold;color:#DC2626;">৳${totalDebit.toFixed(2)}</div>
            </td>
            <td style="width:33.33%;padding:16px;border-right:1px solid #E5E7EB;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">মোট জমা(+)</div>
              <div style="font-size:18px;font-weight:bold;color:#16A34A;">৳${totalCredit.toFixed(2)}</div>
            </td>
            <td style="width:33.33%;padding:16px;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">মোট ব্যালেন্স</div>
              <div style="font-size:18px;font-weight:bold;color:${netBalance >= 0 ? '#16A34A' : '#DC2626'};">
                ৳${Math.abs(netBalance).toFixed(2)} ${netBalance >= 0 ? 'Cr' : 'Dr'}
              </div>
            </td>
          </tr>
        </table>

        <!-- Count label -->
        <div style="font-size:15px;font-weight:bold;color:#000;margin-bottom:12px;">
          এন্ট্রির সংখ্যা: ${pdfEntries.length} (সব)
        </div>

        <!-- 4. Transaction Table -->
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#000;">
          <thead>
            <tr style="background:#F8FAFC;font-weight:bold;">
              <th style="padding:10px;border:1px solid #000;width:18%;text-align:left;">তারিখ</th>
              <th style="padding:10px;border:1px solid #000;width:26%;text-align:left;">${isSupplier ? 'সরবরাহকারীর নাম' : 'গ্রাহকের নাম'}</th>
              <th style="padding:10px;border:1px solid #000;text-align:left;">ডিটেলস</th>
              <th style="padding:10px;border:1px solid #000;width:15%;text-align:right;background:#FEF2F2;">ডেবিট (-)</th>
              <th style="padding:10px;border:1px solid #000;width:15%;text-align:right;background:#F0FDF4;">ক্রেডিট (+)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="5" style="padding:16px;text-align:center;color:#94A3B8;border:1px solid #000;">কোনো এন্ট্রি নেই</td></tr>`}
          </tbody>
        </table>
      </div>

      <!-- 5. Deep Navy Footer Strip -->
      <div style="background:#003366;color:#fff;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;margin-top:40px;font-size:13px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span>এখনই Banglakhata ব্যবহার শুরু করুন</span>
          <span style="background:#fff;color:#003366;padding:4px 10px;font-weight:bold;border-radius:4px;">ইনস্টল করুন</span>
        </div>
        <div>
          ${footerPhone ? `📞 ${footerPhone}` : 'সাহায্য: support@banglakhata.com'} | নিয়ম ও শর্তাবলী প্রযোজ্য
        </div>
      </div>
    `;

    document.body.appendChild(container);
    try {
      const canvas = await html2canvas(container, {
        scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
      });
      document.body.removeChild(container);

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf     = new jsPDF('p', 'mm', 'a4');
      const pdfW    = 210;
      const pdfH    = 297;
      const imgH    = (canvas.height * pdfW) / canvas.width;
      let yOffset   = 0;
      let first     = true;
      while (yOffset < imgH) {
        if (!first) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, imgH);
        yOffset += pdfH;
        first = false;
      }

      const tag      = isSupplier ? 'Supplier' : 'Customer';
      const filename = `Banglakhata_${tag}_Ledger_${new Date().toISOString().split('T')[0]}.pdf`;
      const pdfBlob  = pdf.output('blob');
      const pdfFile  = new File([pdfBlob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({ files: [pdfFile], title: `${roleLabel} লেনদেনের রিপোর্ট` });
        } catch (err) {
          if ((err as DOMException).name !== 'AbortError') pdf.save(filename);
        }
      } else {
        pdf.save(filename);
      }
      toast.success('পিডিএফ রিপোর্ট ডাউনলোড হয়েছে');
    } catch (err) {
      if (document.body.contains(container)) document.body.removeChild(container);
      console.error('Report PDF failed:', err);
      toast.error('রিপোর্ট তৈরি করতে সমস্যা হয়েছে।');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCsvExport = async () => {
    setIsExportingCsv(true);
    try {
      const csv = buildGlobalLedgerReportCsv(entries);
      const filename = `Banglakhata_${isSupplier ? 'Supplier' : 'Customer'}_Ledger_${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const file = new File([blob], filename, { type: 'text/csv' });
      let shared = false;
      let canShareFile = false;

      try {
        canShareFile = Boolean(navigator.canShare?.({ files: [file] }));
      } catch {
        // Fall back to a normal download if this browser cannot inspect the file share payload.
      }

      if (canShareFile) {
        try {
          await navigator.share({ files: [file], title: `${roleLabel} লেনদেনের CSV রিপোর্ট` });
          shared = true;
        } catch (error) {
          if ((error as DOMException).name === 'AbortError') return;
        }
      }

      if (!shared) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      toast.success(shared ? 'CSV রিপোর্ট শেয়ার করা হয়েছে' : 'CSV রিপোর্ট ডাউনলোড হয়েছে');
    } catch (error) {
      console.error('Report CSV export failed:', error);
      toast.error('CSV রিপোর্ট তৈরি করতে সমস্যা হয়েছে।');
    } finally {
      setIsExportingCsv(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* Deep blue header */}
      <div className="shrink-0 bg-[#0b57d0] px-4 pb-4 pt-[calc(1rem+var(--safe-top))] flex items-center gap-3 z-10">
        <button onClick={() => navigate('/')} aria-label="ফিরে যান" className="text-white active:opacity-70 transition-opacity">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-white font-extrabold text-[17px] tracking-tight">
          {roleLabel} রিপোর্ট দেখুন
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* Date range pickers */}
        <div className="grid grid-cols-2 gap-2.5 p-4">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={calendarFor === 'start'}
            onClick={() => setCalendarFor('start')}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-all active:scale-[0.98]"
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">আরম্ভের তারিখ</p>
              <p className="truncate text-[13px] font-bold text-slate-800">
                {startDate ? formatBengaliDateInput(startDate) : 'নির্বাচন করুন'}
              </p>
            </div>
          </button>

          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={calendarFor === 'end'}
            onClick={() => setCalendarFor('end')}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-all active:scale-[0.98]"
          >
            <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">শেষের তারিখ</p>
              <p className="truncate text-[13px] font-bold text-slate-800">
                {endDate ? formatBengaliDateInput(endDate) : 'নির্বাচন করুন'}
              </p>
            </div>
          </button>
        </div>

        {/* Search + period dropdown */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="এন্ট্রি অনুসন্ধান করুন"
              className="pl-10 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setIsPeriodOpen(true)}
            className="flex items-center gap-1.5 h-11 px-4 rounded-xl bg-[#0b57d0] text-white font-bold text-sm shrink-0 active:scale-95 transition-all"
          >
            {PERIOD_LABELS[period]}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Metrics bar */}
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-slate-500">মোট ব্যালেন্স</p>
            <p className={cn('text-xl font-extrabold tracking-tight', netBalance >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {formatCurrency(Math.abs(netBalance))}
            </p>
          </div>
          <div className="grid grid-cols-3 bg-slate-50 border border-slate-200 rounded-xl p-3 gap-2">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">মোট</p>
              <p className="text-[13px] font-extrabold text-slate-800 mt-0.5">{entries.length} এন্ট্রি</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">দিয়েছেন</p>
              <p className="text-[13px] font-extrabold text-red-600 mt-0.5">{formatCurrency(totalDebit)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">পেয়েছেন</p>
              <p className="text-[13px] font-extrabold text-emerald-600 mt-0.5">{formatCurrency(totalCredit)}</p>
            </div>
          </div>
        </div>

        {/* Entries list */}
        {isLoading ? (
          <div className="flex justify-center p-12">
            <div className="animate-pulse w-8 h-8 rounded-full bg-slate-200" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 px-8 text-center">
            <p className="text-sm font-medium">এই সময়কালে কোনো লেনদেন পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {entries.map((entry) => {
              const isGave = entry.type === 'YOU_GAVE';
              const imgSrc = billImageSrc(entry.billImage);
              return (
                <div
                  key={entry.id}
                  className="bg-white border border-slate-100 rounded-xl shadow-sm grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-center overflow-hidden"
                >
                  <div className="min-w-0 py-3 pl-4">
                    <p className="text-[13px] font-bold text-slate-800 truncate">{entry.partyName}</p>
                    <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                      {format(new Date(entry.createdAt), 'd MMM yy')} • {format(new Date(entry.createdAt), 'hh:mm a')}
                    </p>
                    {entry.description && (
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">{entry.description}</p>
                    )}
                    {imgSrc && (
                      <button
                        type="button"
                        onClick={() => setLightboxSrc(imgSrc)}
                        className="mt-1.5 block active:opacity-70 transition-opacity"
                        aria-label="বিলের ছবি দেখুন"
                      >
                        <img src={imgSrc} alt="বিল" className="w-10 h-10 rounded-md object-cover border border-slate-200" />
                      </button>
                    )}
                  </div>
                  <div className={cn('min-w-0 h-full flex items-center justify-center px-2 py-3', isGave ? 'bg-[#FFF5F5]' : 'bg-white')}>
                    {isGave && (
                      <span className="shrink-0 whitespace-nowrap text-[clamp(0.625rem,2.8vw,0.875rem)] font-extrabold leading-none text-red-700">
                        {formatCurrency(entry.amount)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 h-full flex items-center justify-end bg-white py-3 pl-2 pr-4">
                    {!isGave && (
                      <span className="shrink-0 whitespace-nowrap text-[clamp(0.625rem,2.8vw,0.875rem)] font-extrabold leading-none text-emerald-600">
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

      {/* Sticky report export footer */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pt-3 pb-[calc(0.75rem+var(--safe-bottom))] bg-white border-t border-slate-200 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] shrink-0 z-20">
        <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={isGenerating}
          className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl bg-[#0b57d0] text-white font-extrabold text-[15px] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
          {isGenerating ? 'তৈরি হচ্ছে…' : '📥 ডাউনলোড'}
        </button>
        <button
          type="button"
          onClick={handleCsvExport}
          disabled={isLoading || isExportingCsv}
          className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl border border-[#0b57d0] bg-white text-[#0b57d0] font-extrabold text-sm active:scale-[0.98] transition-all disabled:opacity-60"
          aria-label="CSV রিপোর্ট ডাউনলোড বা শেয়ার করুন"
        >
          {isExportingCsv ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
          {isExportingCsv ? 'তৈরি হচ্ছে…' : 'CSV ডাউনলোড'}
        </button>
        </div>
      </div>

      <ReportPeriodDrawer open={isPeriodOpen} onOpenChange={setIsPeriodOpen} value={period} onSelect={setPeriod} />
      {calendarFor === 'start' && (
        <BengaliCalendarModal
          ariaLabel="আরম্ভের তারিখ নির্বাচন করুন"
          value={startDate}
          onConfirm={(date) => {
            setStartDate(date);
            if (period !== 'CUSTOM_RANGE' && period !== 'SINGLE_DAY') setPeriod('CUSTOM_RANGE');
            setCalendarFor(null);
          }}
          onCancel={() => setCalendarFor(null)}
          onClear={() => {
            setStartDate(null);
            if (period === 'SINGLE_DAY') setPeriod('ALL');
            setCalendarFor(null);
          }}
        />
      )}
      {calendarFor === 'end' && (
        <BengaliCalendarModal
          ariaLabel="শেষের তারিখ নির্বাচন করুন"
          value={endDate}
          onConfirm={(date) => {
            setEndDate(date);
            setPeriod('CUSTOM_RANGE');
            setCalendarFor(null);
          }}
          onCancel={() => setCalendarFor(null)}
          onClear={() => {
            setEndDate(null);
            setCalendarFor(null);
          }}
        />
      )}
      {lightboxSrc && <BillImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
