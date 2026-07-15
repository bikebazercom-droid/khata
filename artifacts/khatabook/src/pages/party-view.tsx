import { useMemo, useRef, useState } from 'react';
import { useRoute, Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetParty,
  useListLedgerEntries,
  useDeleteParty,
  useGetBusinessSettings,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
  LedgerEntryType,
} from '@workspace/api-client-react';
import html2pdf from 'html2pdf.js';
import {
  ChevronLeft,
  Phone,
  FileText,
  Copy,
  Check,
  Trash2,
  FileDown,
  MessageCircle,
  MessageSquareText,
  Plus,
  Loader2,
} from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { TransactionEntryScreen } from '@/components/modals/transaction-entry-screen';
import {
  LedgerReportDocument,
  buildReportFilename,
  buildWhatsAppReminderText,
  toWhatsAppNumber,
  stampPageNumbers,
} from '@/lib/ledger-report';
import { format, isToday } from 'date-fns';
import { toast } from 'sonner';

/**
 * The entry's real transaction date. Users can backdate/forward-date an
 * entry via the date field in the transaction entry screen (stored as
 * `dueDate`); fall back to the entry's insertion date only when unset.
 */
function entryDateKey(entry: { dueDate: string | null; createdAt: string | Date }) {
  // `dueDate` may arrive as a plain "yyyy-MM-dd" or as a full ISO timestamp
  // (e.g. "2026-07-01T00:00:00.000Z") depending on the serializer; normalize
  // either shape (or the createdAt fallback) to a bare calendar-day key.
  return format(new Date(entry.dueDate || entry.createdAt), 'yyyy-MM-dd');
}

/** Groups already-sorted entries by calendar day, preserving the given order. */
function groupByDay<T extends { dueDate: string | null; createdAt: string | Date }>(entries: T[]) {
  const groups: { dayKey: string; date: Date; items: T[] }[] = [];
  for (const entry of entries) {
    const dayKey = entryDateKey(entry);
    const date = new Date(`${dayKey}T00:00:00`);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.items.push(entry);
    } else {
      groups.push({ dayKey, date, items: [entry] });
    }
  }
  return groups;
}

export function PartyView() {
  const [, params] = useRoute('/party/:id');
  const id = params?.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: party, isLoading: partyLoading } = useGetParty(id || '', { query: { enabled: !!id, queryKey: getGetPartyQueryKey(id || '') } });
  const { data: entries = [], isLoading: entriesLoading } = useListLedgerEntries(id || '', { query: { enabled: !!id, queryKey: getListLedgerEntriesQueryKey(id || '') } });
  const { data: settings } = useGetBusinessSettings();
  const deleteParty = useDeleteParty();

  const [transactionType, setTransactionType] = useState<LedgerEntryType | null>(null);
  const [smsMessage, setSmsMessage] = useState<string | null>(null);
  const [copiedSms, setCopiedSms] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingReminder, setIsGeneratingReminder] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const storeName = settings?.storeName || 'হাজারী খাতাবুক';

  // Dual-sorting pipeline: one true chronological reconstruction feeds both
  // the newest-first screen view and the oldest-first PDF/reminder timeline.
  //
  // The backend applies each entry's delta to the party's running total in
  // insertion order, not transaction-date order, so `currentBalance` cannot
  // simply be unwound entry-by-entry once backdating is involved. Addition
  // is commutative, though: the true opening balance (before any entry)
  // equals currentBalance minus the sum of every entry's delta, regardless
  // of order. Walking forward from that opening balance through entries
  // sorted by their real transaction date (`dueDate`, falling back to the
  // insertion date) yields the correct running balance at every point in
  // the actual timeline.
  const ascendingEntries = useMemo(() => {
    if (!party) return [] as (typeof entries[number] & { balanceAfter: number })[];
    const signedDelta = (entry: (typeof entries)[number]) => (entry.type === 'YOU_GAVE' ? entry.amount : -entry.amount);
    const signedCurrent = party.balanceType === 'YOU_WILL_GET' ? party.currentBalance : -party.currentBalance;
    const totalDelta = entries.reduce((sum, entry) => sum + signedDelta(entry), 0);
    let running = signedCurrent - totalDelta; // balance before the earliest entry

    const sorted = [...entries].sort((a, b) => {
      const dayCompare = entryDateKey(a).localeCompare(entryDateKey(b));
      if (dayCompare !== 0) return dayCompare;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return sorted.map((entry) => {
      running += signedDelta(entry);
      return { ...entry, balanceAfter: running };
    });
  }, [entries, party]);

  const descendingEntries = useMemo(() => [...ascendingEntries].reverse(), [ascendingEntries]);

  const groupedEntries = useMemo(() => groupByDay(descendingEntries), [descendingEntries]);

  const handleDelete = () => {
    if (!id) return;
    deleteParty.mutate(
      { partyId: id },
      {
        onSuccess: () => {
          setShowDeleteConfirm(false);
          queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast.success('কাস্টমার সফলভাবে ডিলিট করা হয়েছে');
          navigate('/');
        },
        onError: () => {
          toast.error('কাস্টমার ডিলিট করা যায়নি');
        },
      }
    );
  };

  /** Renders the hidden report DOM node into a jsPDF worker instance. */
  const buildReportPdf = () => {
    if (!reportRef.current) return null;
    return html2pdf().set({
      margin: 10,
      filename: party ? buildReportFilename(party.name) : 'হিসাব_খাতা.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
    }).from(reportRef.current);
  };

  /**
   * Advances a fresh html2pdf worker through PDF generation and stamps
   * "Page X of Y" on every page. html2pdf's Worker.then() returns another
   * chainable Worker at runtime (unlike the shipped .d.ts, which types it as
   * a plain Promise), so `.save()`/`.outputPdf()` remain callable after
   * this — hence the cast back to the worker type.
   */
  const finalizeReportPdf = (worker: NonNullable<ReturnType<typeof buildReportPdf>>) =>
    worker
      .toPdf()
      .get('pdf')
      .then((pdf) => {
        stampPageNumbers(pdf);
      }) as unknown as NonNullable<ReturnType<typeof buildReportPdf>>;

  const handleReport = async () => {
    if (!party) return;
    setIsGeneratingReport(true);
    try {
      const worker = buildReportPdf();
      if (!worker) throw new Error('report element not ready');
      await finalizeReportPdf(worker).save();
      toast.success('পিডিএফ রিপোর্ট ডাউনলোড হয়েছে');
    } catch (err) {
      console.error('Report generation failed', err);
      toast.error('রিপোর্ট তৈরি করা যায়নি');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleReminderShare = async () => {
    if (!party) return;
    setIsGeneratingReminder(true);
    try {
      const worker = buildReportPdf();
      if (!worker) throw new Error('report element not ready');
      const blob = await finalizeReportPdf(worker).outputPdf('blob');
      const filename = buildReportFilename(party.name);
      const messageText = buildWhatsAppReminderText(storeName, party);
      const file = new File([blob], filename, { type: 'application/pdf' });

      const canShareFile =
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFile) {
        await navigator.share({
          files: [file],
          title: 'হিসাবের রিপোর্ট',
          text: messageText,
        });
        toast.success('শেয়ার শীট খোলা হয়েছে');
        return;
      }

      // Fallback: download the PDF locally, then open a real WhatsApp deep
      // link pre-filled with the ledger summary (wa.me can't attach files).
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const waNumber = toWhatsAppNumber(party.phone);
      window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(messageText)}`, '_blank');
      toast.success('পিডিএফ ডাউনলোড হয়েছে এবং WhatsApp খোলা হয়েছে');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled the native share sheet — not an error.
        return;
      }
      console.error('Reminder share failed', err);
      toast.error('রিমাইন্ডার পাঠানো যায়নি');
    } finally {
      setIsGeneratingReminder(false);
    }
  };

  const handleSms = () => {
    if (!party) return;
    const label = party.balanceType === 'YOU_WILL_GET' ? 'আপনি পাবেন' : 'আপনি দেবেন';
    setSmsMessage(
      `প্রিয় ${party.name}, আপনার হিসাবে ${label} ${formatCurrency(party.currentBalance)}। ধন্যবাদান্তে, হাজারী খাতাবুক।`
    );
    setCopiedSms(false);
  };

  const handleCopySms = async () => {
    if (!smsMessage) return;
    try {
      await navigator.clipboard.writeText(smsMessage);
      setCopiedSms(true);
      toast.success('বার্তা কপি করা হয়েছে');
      setTimeout(() => setCopiedSms(false), 2000);
    } catch {
      toast.error('কপি করা যায়নি');
    }
  };

  if (!id) return null;

  if (partyLoading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-slate-50">
        <div className="h-32 bg-white border-b border-slate-200 animate-pulse"></div>
        <div className="flex-1 p-4">
          <div className="h-20 bg-slate-200/50 rounded-xl mb-4 animate-pulse"></div>
          <div className="h-20 bg-slate-200/50 rounded-xl mb-4 animate-pulse"></div>
          <div className="h-20 bg-slate-200/50 rounded-xl mb-4 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (!party) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 font-medium h-full">
        পার্টি খুঁজে পাওয়া যায়নি
        <Link href="/">
          <Button variant="outline" size="sm">
            <ChevronLeft className="w-4 h-4 mr-1" /> পিছনে যান
          </Button>
        </Link>
      </div>
    );
  }

  const isGive = party.balanceType === 'YOU_WILL_GIVE';

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] w-full relative">
      {/* Sticky blue top header */}
      <div className="bg-[#0b57d0] shadow-sm z-10 shrink-0 sticky top-0">
        <div className="flex items-center gap-3 px-3 pt-3 pb-6">
          <Link
            href="/"
            aria-label="পিছনে যান"
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 text-[#0b57d0]">
            <Plus className="w-5 h-5" strokeWidth={3} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-extrabold text-white leading-tight truncate">{party.name}</h2>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/20 text-white uppercase tracking-wider shrink-0">
                {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-white transition-colors"
                >
                  সেটিংস দেখুন
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" /> কাস্টমার ডিলিট করুন
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <a
            href={`tel:${party.phone}`}
            aria-label="কল করুন"
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <Phone className="w-5 h-5" />
          </a>
        </div>
      </div>

      {/* Floating summary card overlapping the blue header */}
      <div className="px-3 -mt-4 shrink-0 relative z-10">
        <div className="bg-white rounded-2xl shadow-md px-4 py-3.5 flex items-center justify-between">
          <p className={cn('text-sm font-extrabold', isGive ? 'text-red-600' : 'text-emerald-600')}>
            {isGive ? 'আপনি দেবেন' : 'আপনি পাবেন'}
          </p>
          <p className={cn('text-xl font-extrabold tracking-tight', isGive ? 'text-red-600' : 'text-emerald-600')}>
            {formatCurrency(party.currentBalance)}
          </p>
        </div>
      </div>

      {/* Action buttons bar */}
      <div className="bg-white mt-3 shrink-0 border-b border-slate-200 grid grid-cols-3 divide-x divide-slate-100">
        <button
          type="button"
          onClick={handleReport}
          disabled={isGeneratingReport}
          className="flex flex-col items-center gap-1 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-60"
        >
          {isGeneratingReport ? (
            <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
          ) : (
            <FileDown className="w-5 h-5 text-slate-500" />
          )}
          <span className="text-[11px] font-bold text-slate-600">রিপোর্ট</span>
        </button>
        <button
          type="button"
          onClick={handleReminderShare}
          disabled={isGeneratingReminder}
          className="flex flex-col items-center gap-1 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors disabled:opacity-60"
        >
          {isGeneratingReminder ? (
            <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
          ) : (
            <MessageCircle className="w-5 h-5 text-emerald-500" />
          )}
          <span className="text-[11px] font-bold text-slate-600">রিমাইন্ডার</span>
        </button>
        <button
          type="button"
          onClick={handleSms}
          className="flex flex-col items-center gap-1 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
        >
          <MessageSquareText className="w-5 h-5 text-slate-400" />
          <span className="text-[11px] font-bold text-slate-600">এসএমএস</span>
        </button>
      </div>

      {/* Scrollable ledger area */}
      <div className="flex-1 overflow-y-auto pb-4">
        {entriesLoading ? (
          <div className="flex justify-center p-12">
            <div className="animate-pulse w-8 h-8 rounded-full bg-slate-200"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-xs mx-auto py-16 px-3">
            <div className="w-20 h-20 bg-white border-4 border-slate-100 shadow-sm rounded-full flex items-center justify-center mb-5 text-slate-300">
              <FileText className="w-9 h-9" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 tracking-tight">এখনো কোনো লেনদেন নেই</h3>
            <p className="text-slate-500 font-medium text-sm">{party.name}-এর সাথে হিসাব রাখা শুরু করতে একটি লেনদেন যুক্ত করুন।</p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="sticky top-0 z-[5] bg-[#f8fafc] grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>এন্ট্রি</span>
              <span className="w-20 text-center">আপনি দিয়েছেন</span>
              <span className="w-20 text-right">আপনি পেয়েছেন</span>
            </div>

            {groupedEntries.map((group) => (
              <div key={group.dayKey}>
                <div className="sticky top-[26px] z-[4] flex justify-center py-2 bg-[#f8fafc]/95 backdrop-blur-sm">
                  <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                    {format(group.date, 'd MMM yy')}
                    {isToday(group.date) ? ' • আজ' : ''}
                  </span>
                </div>
                <div className="px-3 space-y-2">
                  {group.items.map((entry, i) => {
                    const isGave = entry.type === 'YOU_GAVE';
                    return (
                      <div
                        key={entry.id}
                        className="bg-white rounded-xl shadow-sm grid grid-cols-[1fr_auto_auto] gap-3 items-center overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <div className="min-w-0 py-3 pl-4">
                          <p className="text-[12px] font-bold text-slate-700">
                            {format(new Date(`${entryDateKey(entry)}T00:00:00`), 'd MMM yy')} • {format(new Date(entry.createdAt), 'hh:mm a')}
                          </p>
                          <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                            ব্যালেন্স: {formatCurrency(Math.abs(entry.balanceAfter))}
                          </p>
                          {entry.billReference && (
                            <span className="inline-block mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                              বিল: {entry.billReference}
                            </span>
                          )}
                        </div>
                        <div className={cn('w-20 h-full flex items-center justify-center py-3', isGave ? 'bg-[#FFF5F5]' : 'bg-white')}>
                          {isGave && (
                            <span className="text-sm font-extrabold text-red-700">{formatCurrency(entry.amount)}</span>
                          )}
                        </div>
                        <div className="w-20 h-full flex items-center justify-end py-3 pr-4 bg-white">
                          {!isGave && (
                            <span className="text-sm font-extrabold text-emerald-600">{formatCurrency(entry.amount)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Sticky bottom action overlay */}
      <div className="bg-white border-t border-slate-200 p-3 flex gap-3 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] shrink-0 z-20">
        <Button
          variant="destructive"
          className="flex-1 h-16 text-base font-extrabold shadow-[0_4px_14px_0_rgba(239,68,68,0.35)] active:scale-[0.98] transition-all rounded-2xl"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GAVE)}
        >
          আপনি দিয়েছেন ৳
        </Button>
        <Button
          variant="success"
          className="flex-1 h-16 text-base font-extrabold shadow-[0_4px_14px_0_rgba(16,185,129,0.35)] active:scale-[0.98] transition-all rounded-2xl"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GOT)}
        >
          আপনি পেয়েছেন ৳
        </Button>
      </div>

      {transactionType && (
        <TransactionEntryScreen
          partyId={id}
          partyName={party.name}
          type={transactionType}
          onClose={() => setTransactionType(null)}
        />
      )}

      {/* Off-screen printable ledger report used to render the actual PDF via html2pdf */}
      <div style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1 }} aria-hidden="true">
        <LedgerReportDocument ref={reportRef} storeName={storeName} party={party} entries={ascendingEntries} />
      </div>

      {/* SMS dialog (distinct simulated flow) */}
      <Dialog open={!!smsMessage} onOpenChange={(open) => !open && setSmsMessage(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareText className="w-5 h-5 text-slate-500" /> এসএমএস তৈরি হয়েছে
            </DialogTitle>
          </DialogHeader>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 leading-relaxed">
            {smsMessage}
          </div>
          <Button onClick={handleCopySms} variant="outline" className="w-full font-bold">
            {copiedSms ? <Check className="w-4 h-4 mr-2 text-emerald-600" /> : <Copy className="w-4 h-4 mr-2" />}
            {copiedSms ? 'কপি হয়েছে' : 'বার্তা কপি করুন'}
          </Button>
          <p className="text-xs text-slate-400 font-medium text-center">এটি একটি সিমুলেটেড এসএমএস — কোনো বাস্তব এসএমএস পাঠানো হয়নি।</p>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>কাস্টমার ডিলিট করুন</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              আপনি কি নিশ্চিত যে এই কাস্টমারকে ডিলিট করতে চান? এর ফলে এই কাস্টমারের সমস্ত হিসাব মুছে যাবে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteParty.isPending} className="font-bold">
              বাতিল করুন
            </AlertDialogCancel>
            <Button
              variant="destructive"
              className="font-bold"
              disabled={deleteParty.isPending}
              onClick={handleDelete}
            >
              ডিলিট করুন
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
