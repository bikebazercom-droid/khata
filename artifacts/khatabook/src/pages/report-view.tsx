import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListGlobalLedgerEntries,
  useGetBusinessSettings,
} from '@workspace/api-client-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ChevronLeft, Calendar as CalendarIcon, Search, ChevronDown, FileDown, Loader2 } from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
} from 'date-fns';
import { bn } from 'date-fns/locale';
import { toast } from 'sonner';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ReportPeriodDrawer, type ReportPeriod } from '@/components/modals/report-period-drawer';
import { BillImageLightbox } from '@/components/modals/bill-image-lightbox';
import { billImageSrc } from '@/lib/billImageStorage';
import { loadShopProfile } from '@/components/modals/settings-drawer';

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  ALL: 'সব',
  THIS_MONTH: 'এই মাসে',
  SINGLE_DAY: 'এক দিন',
  LAST_WEEK: 'গত সপ্তাহে',
  LAST_MONTH: 'গত মাসের',
  CUSTOM_RANGE: 'তারিখের পরিসর',
};

function toDateOnly(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function resolveDateRange(period: ReportPeriod, customStart: Date | null, customEnd: Date | null) {
  const today = new Date();
  switch (period) {
    case 'ALL':
      return { startDate: undefined, endDate: undefined };
    case 'THIS_MONTH':
      return { startDate: toDateOnly(startOfMonth(today)), endDate: toDateOnly(endOfMonth(today)) };
    case 'LAST_MONTH': {
      const lastMonth = subMonths(today, 1);
      return { startDate: toDateOnly(startOfMonth(lastMonth)), endDate: toDateOnly(endOfMonth(lastMonth)) };
    }
    case 'LAST_WEEK':
      return { startDate: toDateOnly(subDays(today, 6)), endDate: toDateOnly(today) };
    case 'SINGLE_DAY': {
      const day = customStart ?? today;
      return { startDate: toDateOnly(day), endDate: toDateOnly(day) };
    }
    case 'CUSTOM_RANGE':
      return {
        startDate: customStart ? toDateOnly(customStart) : undefined,
        endDate: customEnd ? toDateOnly(customEnd) : undefined,
      };
    default:
      return { startDate: undefined, endDate: undefined };
  }
}

export function ReportView() {
  const [, navigate] = useLocation();

  // useSearch() uses useSyncExternalStore and can produce a stale snapshot in
  // React 18 concurrent mode before the pushState event is committed.
  // Reading window.location.search directly is always ground-truth — pushState
  // already ran before React rendered this component.
  // useLocation() is kept solely as a reactive trigger: if the URL changes
  // while the component stays mounted, it will re-render and re-read the search.
  const [_currentPath] = useLocation(); // reactive trigger — value intentionally unused
  const roleParam = new URLSearchParams(window.location.search).get('role') ?? 'customer';
  const isSupplier = roleParam === 'supplier';
  const partyRole = isSupplier ? 'SUPPLIER' : 'CUSTOMER';
  const roleLabel = isSupplier ? 'সরবরাহকারী' : 'গ্রাহক';

  const { data: settings } = useGetBusinessSettings();

  const [period, setPeriod] = useState<ReportPeriod>('ALL');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const { startDate: rangeStart, endDate: rangeEnd } = resolveDateRange(period, startDate, endDate);

  const { data: entries = [], isLoading } = useListGlobalLedgerEntries({
    startDate: rangeStart,
    endDate: rangeEnd,
    search: search || undefined,
    partyRole,
  });

  const totalDebit  = useMemo(() => entries.reduce((s, e) => e.type === 'YOU_GAVE' ? s + e.amount : s, 0), [entries]);
  const totalCredit = useMemo(() => entries.reduce((s, e) => e.type === 'YOU_GOT'  ? s + e.amount : s, 0), [entries]);
  const netBalance  = totalCredit - totalDebit;

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
    const timeStr    = new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });
    const footerAddress = shopProfile.address || '';
    const footerPhone   = shopProfile.phone   || '';

    const rowsHtml = entries.map(e => {
      const isGave   = e.type === 'YOU_GAVE';
      const dateCell = format(new Date(e.createdAt), 'd MMM yy • hh:mm a');
      const amtStyle = isGave
        ? 'background:#FEF2F2;color:#DC2626;font-weight:bold;'
        : 'background:#F0FDF4;color:#16A34A;font-weight:bold;';
      return `
        <tr>
          <td style="padding:8px 10px;border:1px solid #E2E8F0;font-size:12px;color:#475569;">${dateCell}</td>
          <td style="padding:8px 10px;border:1px solid #E2E8F0;font-size:12px;font-weight:500;">${e.partyName || '—'}</td>
          <td style="padding:8px 10px;border:1px solid #E2E8F0;font-size:11px;color:#64748B;">${e.description || '—'}</td>
          <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:right;${amtStyle}">৳${e.amount.toFixed(2)}</td>
        </tr>`;
    }).join('');

    const container = document.createElement('div');
    container.style.cssText = [
      'position:absolute', 'left:-9999px', 'top:0', 'width:794px',
      'background:#fff', "font-family:'Noto Sans Bengali','Hind Siliguri',sans-serif",
      'padding-bottom:40px',
    ].join(';');

    container.innerHTML = `
      <!-- Blue header -->
      <div style="background:#004BA0;display:flex;justify-content:space-between;align-items:center;padding:12px 24px;color:#fff;font-size:14px;font-weight:bold;">
        <div>${storeName}</div>
        <div>Khatabook</div>
      </div>

      <!-- Title -->
      <div style="text-align:center;margin:24px 0 8px;">
        <div style="font-size:20px;font-weight:bold;color:#1E293B;">${roleLabel} লেনদেনের রিপোর্ট</div>
        <div style="font-size:13px;color:#64748B;margin-top:4px;">${periodLabel} | ${dateStr}</div>
      </div>

      <!-- Stats card -->
      <div style="margin:0 24px 16px;border:1px solid #E2E8F0;border-radius:4px;display:table;width:calc(100% - 48px);border-collapse:collapse;">
        <div style="display:table-row;">
          <div style="display:table-cell;width:33.33%;text-align:center;padding:12px;border-right:1px solid #E2E8F0;">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:4px;">মোট এন্ট্রি</div>
            <div style="font-size:16px;font-weight:bold;color:#0F172A;">${entries.length}</div>
          </div>
          <div style="display:table-cell;width:33.33%;text-align:center;padding:12px;border-right:1px solid #E2E8F0;">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:4px;">আপনি দিয়েছেন</div>
            <div style="font-size:16px;font-weight:bold;color:#DC2626;">৳${totalDebit.toFixed(2)}</div>
          </div>
          <div style="display:table-cell;width:33.33%;text-align:center;padding:12px;">
            <div style="font-size:11px;color:#94A3B8;margin-bottom:4px;">আপনি পেয়েছেন</div>
            <div style="font-size:16px;font-weight:bold;color:#16A34A;">৳${totalCredit.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <!-- Net balance -->
      <div style="margin:0 24px 16px;padding:10px 16px;border-radius:4px;background:${netBalance >= 0 ? '#F0FDF4' : '#FEF2F2'};display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;font-weight:bold;color:#64748B;">মোট ব্যালেন্স</span>
        <span style="font-size:18px;font-weight:bold;color:${netBalance >= 0 ? '#16A34A' : '#DC2626'};">
          ৳${Math.abs(netBalance).toFixed(2)} ${netBalance >= 0 ? 'Cr' : 'Dr'}
        </span>
      </div>

      <!-- Transaction table -->
      <table style="width:calc(100% - 48px);margin:0 24px;border-collapse:collapse;font-size:12px;color:#334155;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="padding:10px;border:1px solid #E2E8F0;width:22%;text-align:left;">তারিখ ও সময়</th>
            <th style="padding:10px;border:1px solid #E2E8F0;width:25%;text-align:left;">${isSupplier ? 'সরবরাহকারীর নাম' : 'গ্রাহকের নাম'}</th>
            <th style="padding:10px;border:1px solid #E2E8F0;text-align:left;">বিবরণ</th>
            <th style="padding:10px;border:1px solid #E2E8F0;width:16%;text-align:right;">পরিমাণ</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#94A3B8;">কোনো এন্ট্রি নেই</td></tr>`}
        </tbody>
      </table>

      <!-- Footer -->
      <div style="margin:16px 24px 0;border-top:1px solid #E2E8F0;padding-top:10px;display:flex;justify-content:space-between;align-items:flex-end;">
        <div style="font-size:11px;color:#94A3B8;">
          ${footerAddress ? `<div style="margin-bottom:2px;">📍 ${footerAddress}</div>` : ''}
          ${footerPhone   ? `<div>📞 ${footerPhone}</div>`   : ''}
        </div>
        <div style="font-size:10px;color:#CBD5E1;text-align:right;">রিপোর্ট তৈরি: ${timeStr} | ${dateStr}</div>
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
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-xl px-3 py-3 text-left active:scale-[0.98] transition-all">
                <CalendarIcon className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">আরম্ভের তারিখ</p>
                  <p className="text-[13px] font-bold text-slate-800 truncate">
                    {startDate ? format(startDate, 'd MMM yyyy', { locale: bn }) : 'নির্বাচন করুন'}
                  </p>
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate ?? undefined}
                onSelect={(date) => {
                  setStartDate(date ?? null);
                  if (period !== 'CUSTOM_RANGE' && period !== 'SINGLE_DAY') setPeriod('CUSTOM_RANGE');
                }}
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-xl px-3 py-3 text-left active:scale-[0.98] transition-all">
                <CalendarIcon className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">শেষের তারিখ</p>
                  <p className="text-[13px] font-bold text-slate-800 truncate">
                    {endDate ? format(endDate, 'd MMM yyyy', { locale: bn }) : 'নির্বাচন করুন'}
                  </p>
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={endDate ?? undefined}
                onSelect={(date) => {
                  setEndDate(date ?? null);
                  setPeriod('CUSTOM_RANGE');
                }}
              />
            </PopoverContent>
          </Popover>
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
                  className="bg-white border border-slate-100 rounded-xl shadow-sm grid grid-cols-[1fr_auto_auto] gap-3 items-center overflow-hidden"
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
                  <div className={cn('w-20 h-full flex items-center justify-center py-3', isGave ? 'bg-[#FFF5F5]' : 'bg-white')}>
                    {isGave && <span className="text-sm font-extrabold text-red-700">{formatCurrency(entry.amount)}</span>}
                  </div>
                  <div className="w-20 h-full flex items-center justify-end py-3 pr-4 bg-white">
                    {!isGave && <span className="text-sm font-extrabold text-emerald-600">{formatCurrency(entry.amount)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky PDF download footer */}
      <div className="absolute bottom-0 left-0 right-0 px-3 pt-3 pb-[calc(0.75rem+var(--safe-bottom))] bg-white border-t border-slate-200 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] shrink-0 z-20">
        <button
          type="button"
          onClick={handleDownload}
          disabled={isGenerating}
          className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl bg-[#0b57d0] text-white font-extrabold text-[15px] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
          {isGenerating ? 'তৈরি হচ্ছে…' : '📥 ডাউনলোড'}
        </button>
      </div>

      <ReportPeriodDrawer open={isPeriodOpen} onOpenChange={setIsPeriodOpen} value={period} onSelect={setPeriod} />
      {lightboxSrc && <BillImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}
