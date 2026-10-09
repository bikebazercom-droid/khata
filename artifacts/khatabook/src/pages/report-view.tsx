import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  useListGlobalLedgerEntries,
  getListGlobalLedgerEntriesQueryKey,
  useGetBusinessSettings,
  useGetPublicReportBranding,
  getGetBusinessSettingsQueryKey,
  getGetPublicReportBrandingQueryKey,
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
import { formatCurrency, cn, toBengaliDigits, escapeHtml } from '@/lib/utils';
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
import { getLedgerEntryDateKey } from '@/lib/date-time';
import { shareGeneratedFileWithNative } from '@/lib/native-file-export';
import { resolveLedgerBookName } from '@/lib/ledger-book-name';
import { addPdfLinkAnnotations } from '@/lib/pdf-link-annotations';
import {
  renderPdfBrandLogo,
  renderPdfInstallButton,
  renderPdfSupportBox,
} from '@/lib/pdf-report-branding';

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  ALL: 'সব',
  THIS_MONTH: 'এই মাসে',
  SINGLE_DAY: 'এক দিন',
  LAST_WEEK: 'গত সপ্তাহে',
  LAST_MONTH: 'গত মাসের',
  CUSTOM_RANGE: 'তারিখের পরিসর',
};

function reportAmountFontSize(value: string, availableWidth: number): string {
  const estimatedWidthInEm = Array.from(value).reduce((width, character) => {
    if (character === '৳') return width + 0.9;
    if (character === ',' || character === '.') return width + 0.35;
    return width + 0.68;
  }, 0);

  return `${Math.min(14, availableWidth / (estimatedWidthInEm * 1.12))}px`;
}

function reportAmountColumnWidth(viewportWidth: number): number {
  return Math.max(32, ((viewportWidth - 32) * 2) / 7 - 16);
}

const reportTimeFormatter = new Intl.DateTimeFormat('bn-BD', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatReportDate(date: Date): string {
  return toBengaliDigits(format(date, 'd MMM yy', { locale: bn }));
}

function formatReportTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return toBengaliDigits(reportTimeFormatter.format(date));
}

function formatReportTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${formatReportDate(date)} • ${formatReportTime(date)}`;
}

function formatReportEntryTimestamp(
  dueDate: string | null | undefined,
  createdAt: string | Date,
): string {
  const [year, month, day] = getLedgerEntryDateKey(dueDate, createdAt).split('-').map(Number);
  const businessDate = new Date(year, month - 1, day);
  return `${formatReportDate(businessDate)} • ${formatReportTime(createdAt)}`;
}

export function ReportView() {
  const [, navigate] = useLocation();
  const { selectedBusinessId, businesses } = useBusinessContext();
  const activeBusinessName = businesses.find((business) => business.id === selectedBusinessId)?.name;

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
  const { data: reportBranding } = useGetPublicReportBranding({
    query: {
      queryKey: getGetPublicReportBrandingQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
    },
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
      return toBengaliDigits(
        `${format(startDate, 'd MMM yyyy', { locale: bn })} - ${format(endDate, 'd MMM yyyy', { locale: bn })}`,
      );
    if (period === 'SINGLE_DAY' && startDate)
      return toBengaliDigits(format(startDate, 'd MMMM yyyy', { locale: bn }));
    return PERIOD_LABELS[period];
  }, [period, startDate, endDate]);

  // ── HTML-to-canvas PDF (browser shapes Bengali natively) ─────────────────
  const handleDownload = async () => {
    setIsGenerating(true);
    const shopProfile = loadShopProfile();
    const storeName = resolveLedgerBookName(
      activeBusinessName,
      settings?.storeName,
      shopProfile.businessName,
    ) ?? 'বাংলাখাতা';
    const dateStr    = toBengaliDigits(new Date().toLocaleDateString('bn-BD', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }));
    const pdfEntries = sortGlobalLedgerEntriesChronologically(entries);
    const rowsHtml = pdfEntries.map(e => {
      const isGave   = e.type === 'YOU_GAVE';
      const dateCell = formatReportEntryTimestamp(e.dueDate, e.createdAt);
      const debitCell  = isGave
        ? `<td style="padding:10px;border:1px solid #000;text-align:right;background:#FEF2F2;color:#000;font-weight:500;">${formatCurrency(e.amount)}</td>`
        : `<td style="padding:10px;border:1px solid #000;background:#FEF2F2;"></td>`;
      const creditCell = !isGave
        ? `<td style="padding:10px;border:1px solid #000;text-align:right;background:#F0FDF4;color:#000;font-weight:500;">${formatCurrency(e.amount)}</td>`
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
        <span>${escapeHtml(storeName)}</span>
        ${renderPdfBrandLogo(reportBranding?.websiteUrl)}
      </div>

      <div style="padding:30px;box-sizing:border-box;">
        <!-- 2. Title -->
        <div style="text-align:center;margin-bottom:25px;">
          <div style="font-size:24px;font-weight:bold;color:#000;letter-spacing:0.5px;">লেনদেনের বিবরণী</div>
          <div style="font-size:15px;color:#555;font-weight:500;margin-top:6px;">${periodLabel} | ${dateStr}</div>
        </div>

        <!-- 3. Summary Cards -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:25px;text-align:center;border:1px solid #E5E7EB;">
          <tr>
            <td style="width:33.33%;padding:16px;border-right:1px solid #E5E7EB;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">আপনি দিয়েছেন</div>
              <div style="font-size:18px;font-weight:bold;color:#DC2626;">${formatCurrency(totalDebit)}</div>
            </td>
            <td style="width:33.33%;padding:16px;border-right:1px solid #E5E7EB;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">আপনি পেয়েছেন</div>
              <div style="font-size:18px;font-weight:bold;color:#16A34A;">${formatCurrency(totalCredit)}</div>
            </td>
            <td style="width:33.33%;padding:16px;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">মোট ব্যালেন্স</div>
              <div style="font-size:18px;font-weight:bold;color:${netBalance >= 0 ? '#16A34A' : '#DC2626'};">
                ${formatCurrency(Math.abs(netBalance))} ${netBalance >= 0 ? 'পাওনা' : 'দেনা'}
              </div>
            </td>
          </tr>
        </table>

        <!-- Count label -->
        <div style="font-size:15px;font-weight:bold;color:#000;margin-bottom:12px;">
          মোট লেনদেন: ${toBengaliDigits(String(pdfEntries.length))} (${PERIOD_LABELS.ALL})
        </div>

        <!-- 4. Transaction Table -->
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#000;">
          <thead>
            <tr style="background:#F8FAFC;font-weight:bold;">
              <th style="padding:10px;border:1px solid #000;width:18%;text-align:left;">তারিখ</th>
              <th style="padding:10px;border:1px solid #000;width:26%;text-align:left;">${isSupplier ? 'সরবরাহকারীর নাম' : 'গ্রাহকের নাম'}</th>
              <th style="padding:10px;border:1px solid #000;text-align:left;">বিবরণ</th>
              <th style="padding:10px;border:1px solid #000;width:15%;text-align:right;background:#FEF2F2;">আপনি দিয়েছেন</th>
              <th style="padding:10px;border:1px solid #000;width:15%;text-align:right;background:#F0FDF4;">আপনি পেয়েছেন</th>
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
          <span>এখনই বাংলা খাতা ব্যবহার শুরু করুন</span>
          ${renderPdfInstallButton(reportBranding?.playStoreUrl)}
        </div>
        <div style="text-align:right;">
          ${renderPdfSupportBox(reportBranding?.supportPhone, reportBranding?.supportEmail)}
          <div>নিয়ম ও শর্তাবলী প্রযোজ্য</div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    try {
      const canvas = await html2canvas(container, {
        scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
      });

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
      addPdfLinkAnnotations(pdf, container);
      document.body.removeChild(container);

      const tag      = isSupplier ? 'সরবরাহকারী' : 'গ্রাহক';
      const fileDate = toBengaliDigits(new Date().toISOString().split('T')[0]);
      const filename = `বাংলাখাতা_${tag}_হিসাব_${fileDate}.pdf`;
      const pdfBlob  = pdf.output('blob');
      const nativeShare = await shareGeneratedFileWithNative(pdfBlob, {
        fileName: filename,
        mimeType: 'application/pdf',
        title: `${roleLabel} লেনদেনের রিপোর্ট`,
      });
      let shared = nativeShare !== null;
      let downloaded = false;

      if (!nativeShare) {
        const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
          try {
            await navigator.share({ files: [pdfFile], title: `${roleLabel} লেনদেনের রিপোর্ট` });
            shared = true;
          } catch (err) {
            if ((err as DOMException).name === 'AbortError') return;
            pdf.save(filename);
            downloaded = true;
          }
        } else {
          pdf.save(filename);
          downloaded = true;
        }
      }
      if (shared) toast.success('পিডিএফ রিপোর্ট শেয়ার করার জন্য প্রস্তুত');
      else if (downloaded) toast.success('পিডিএফ রিপোর্ট ডাউনলোড হয়েছে');
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
      const tag = isSupplier ? 'সরবরাহকারী' : 'গ্রাহক';
      const fileDate = toBengaliDigits(new Date().toISOString().slice(0, 10));
      const filename = `বাংলাখাতা_${tag}_হিসাব_${fileDate}.csv`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const nativeShare = await shareGeneratedFileWithNative(blob, {
        fileName: filename,
        mimeType: 'text/csv',
        title: `${roleLabel} লেনদেনের সিএসভি রিপোর্ট`,
      });
      let shared = nativeShare !== null;

      if (!nativeShare) {
        const file = new File([blob], filename, { type: 'text/csv' });
        let canShareFile = false;

        try {
          canShareFile = Boolean(navigator.canShare?.({ files: [file] }));
        } catch {
          // Fall back to a normal download if this browser cannot inspect the file share payload.
        }

        if (canShareFile) {
          try {
            await navigator.share({ files: [file], title: `${roleLabel} লেনদেনের সিএসভি রিপোর্ট` });
            shared = true;
          } catch (error) {
            if ((error as DOMException).name === 'AbortError') return;
          }
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

      toast.success(shared ? 'সিএসভি রিপোর্ট শেয়ার করা হয়েছে' : 'সিএসভি রিপোর্ট ডাউনলোড হয়েছে');
    } catch (error) {
      console.error('Report CSV export failed:', error);
      toast.error('সিএসভি রিপোর্ট তৈরি করতে সমস্যা হয়েছে।');
    } finally {
      setIsExportingCsv(false);
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col relative bg-white"
      style={{ fontFamily: "'Noto Sans Bengali', Inter, sans-serif" }}
    >
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
              placeholder="লেনদেন খুঁজুন"
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
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <div className="min-w-0 p-3">
              <p className="text-[10px] font-bold text-slate-500">লেনদেন</p>
              <p className="mt-0.5 text-[13px] font-extrabold text-slate-800">
                {toBengaliDigits(String(entries.length))}টি
              </p>
            </div>
            <div className="min-w-0 border-l border-slate-200 bg-[#FFF8F8] px-2 py-3">
              <p className="text-[9px] font-bold leading-tight text-red-700">আপনি দিয়েছেন</p>
              <p
                className="mt-1 whitespace-nowrap text-right font-extrabold leading-none text-red-600"
                style={{ fontSize: reportAmountFontSize(formatCurrency(totalDebit), reportAmountColumnWidth(window.innerWidth)) }}
              >
                {formatCurrency(totalDebit)}
              </p>
            </div>
            <div className="min-w-0 border-l border-slate-200 bg-[#F3FCF5] px-2 py-3 text-right">
              <p className="text-[9px] font-bold leading-tight text-emerald-700">আপনি পেয়েছেন</p>
              <p
                className="mt-1 whitespace-nowrap text-right font-extrabold leading-none text-emerald-600"
                style={{ fontSize: reportAmountFontSize(formatCurrency(totalCredit), reportAmountColumnWidth(window.innerWidth)) }}
              >
                {formatCurrency(totalCredit)}
              </p>
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
            <p className="text-sm font-medium">এই সময়ে কোনো লেনদেন পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {entries.map((entry) => {
              const isGave = entry.type === 'YOU_GAVE';
              const imgSrc = billImageSrc(entry.billImage);
              const formattedAmount = formatCurrency(entry.amount);
              const amountFontSize = reportAmountFontSize(
                formattedAmount,
                reportAmountColumnWidth(window.innerWidth),
              );
              return (
                <div
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="min-w-0 px-3 py-2.5">
                    <p className="text-[13px] font-bold text-slate-800 truncate">{entry.partyName}</p>
                    <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                      {formatReportTimestamp(entry.createdAt)}
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
                  <div
                    role="group"
                    aria-label="আপনি দিয়েছেন"
                    className="flex min-w-0 items-center justify-end border-l border-slate-100 bg-[#FFF5F5] px-1.5 py-2.5"
                  >
                    {isGave && (
                      <span
                        className="whitespace-nowrap text-right font-extrabold leading-none text-red-700"
                        style={{ fontSize: amountFontSize }}
                      >
                        {formattedAmount}
                      </span>
                    )}
                  </div>
                  <div
                    role="group"
                    aria-label="আপনি পেয়েছেন"
                    className="flex min-w-0 items-center justify-end border-l border-slate-100 bg-[#F0FDF4] px-1.5 py-2.5"
                  >
                    {!isGave && (
                      <span
                        className="whitespace-nowrap text-right font-extrabold leading-none text-emerald-600"
                        style={{ fontSize: amountFontSize }}
                      >
                        {formattedAmount}
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
          aria-label="সিএসভি রিপোর্ট ডাউনলোড বা শেয়ার করুন"
        >
          {isExportingCsv ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
          {isExportingCsv ? 'তৈরি হচ্ছে…' : 'সিএসভি ডাউনলোড'}
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
