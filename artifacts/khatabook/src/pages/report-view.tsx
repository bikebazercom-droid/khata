import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useListGlobalLedgerEntries,
  useGetBusinessSettings,
} from '@workspace/api-client-react';
import html2pdf from 'html2pdf.js';
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
import { GlobalReportDocument, buildGlobalReportFilename } from '@/lib/global-ledger-report';
import { stampPageNumbers } from '@/lib/ledger-report';

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

/** Derives the effective start/end date-only strings for a report period preset. */
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
  const { data: settings } = useGetBusinessSettings();
  const storeName = settings?.storeName || 'হাজারী খাতাবুক';

  const [period, setPeriod] = useState<ReportPeriod>('ALL');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const { startDate: rangeStart, endDate: rangeEnd } = resolveDateRange(period, startDate, endDate);

  const { data: entries = [], isLoading } = useListGlobalLedgerEntries({
    startDate: rangeStart,
    endDate: rangeEnd,
    search: search || undefined,
  });

  // The PDF groups entries by month using each entry's real transaction date
  // (dueDate, falling back to createdAt), which can diverge from createdAt
  // for backdated entries. Sorting explicitly by that same date (rather than
  // just reversing the createdAt-desc API order) keeps every month's rows
  // contiguous so groupByMonth never re-opens the same month twice.
  const ascendingEntries = useMemo(
    () =>
      [...entries].sort(
        (a, b) => new Date(a.dueDate || a.createdAt).getTime() - new Date(b.dueDate || b.createdAt).getTime()
      ),
    [entries]
  );

  const totalDebit = useMemo(() => entries.reduce((sum, e) => (e.type === 'YOU_GAVE' ? sum + e.amount : sum), 0), [entries]);
  const totalCredit = useMemo(() => entries.reduce((sum, e) => (e.type === 'YOU_GOT' ? sum + e.amount : sum), 0), [entries]);
  const netBalance = totalCredit - totalDebit;

  const periodLabel = useMemo(() => {
    if (period === 'CUSTOM_RANGE' && startDate && endDate) {
      return `${format(startDate, 'd MMM yyyy', { locale: bn })} - ${format(endDate, 'd MMM yyyy', { locale: bn })}`;
    }
    if (period === 'SINGLE_DAY' && startDate) {
      return format(startDate, 'd MMMM yyyy', { locale: bn });
    }
    return PERIOD_LABELS[period];
  }, [period, startDate, endDate]);

  const handleDownload = async () => {
    if (!reportRef.current) return;
    setIsGenerating(true);
    try {
      const worker = html2pdf().set({
        margin: 10,
        filename: buildGlobalReportFilename(storeName),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
      }).from(reportRef.current);
      await (worker
        .toPdf()
        .get('pdf')
        .then((pdf: Parameters<typeof stampPageNumbers>[0]) => {
          stampPageNumbers(pdf);
        }) as unknown as typeof worker).save();
      toast.success('পিডিএফ রিপোর্ট ডাউনলোড হয়েছে');
    } catch (err) {
      console.error('Global report generation failed', err);
      toast.error('রিপোর্ট তৈরি করা যায়নি');
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
        <h1 className="text-white font-extrabold text-[17px] tracking-tight">রিপোর্ট দেখুন</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* Date range pickers */}
        <div className="grid grid-cols-2 gap-2.5 p-4">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-xl px-3 py-3 text-left active:scale-[0.98] transition-all"
              >
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
              <button
                type="button"
                className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-xl px-3 py-3 text-left active:scale-[0.98] transition-all"
              >
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
          <div className="grid grid-cols-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">মোট</p>
              <p className="text-[13px] font-extrabold text-slate-800 mt-0.5">{entries.length} এন্ট্রিগুলো</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">আপনি দিয়েছেন</p>
              <p className="text-[13px] font-extrabold text-red-600 mt-0.5">{formatCurrency(totalDebit)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">আপনি পেয়েছেন</p>
              <p className="text-[13px] font-extrabold text-emerald-600 mt-0.5">{formatCurrency(totalCredit)}</p>
            </div>
          </div>
        </div>

        {/* Entries list */}
        {isLoading ? (
          <div className="flex justify-center p-12">
            <div className="animate-pulse w-8 h-8 rounded-full bg-slate-200"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 px-8 text-center">
            <p className="text-sm font-medium">এই সময়কালে কোনো লেনদেন পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="px-4 space-y-2">
            {entries.map((entry) => {
              const isGave = entry.type === 'YOU_GAVE';
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
          ডাউনলোড
        </button>
      </div>

      {/* Off-screen printable report used to render the actual PDF via html2pdf */}
      <div style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1 }} aria-hidden="true">
        <GlobalReportDocument ref={reportRef} storeName={storeName} periodLabel={periodLabel} entries={ascendingEntries} />
      </div>

      <ReportPeriodDrawer open={isPeriodOpen} onOpenChange={setIsPeriodOpen} value={period} onSelect={setPeriod} />
    </div>
  );
}
