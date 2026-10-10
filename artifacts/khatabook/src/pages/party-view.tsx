import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoute, Link, useLocation } from 'wouter';
import {
  useGetParty,
  useListLedgerEntries,
  useListParties,
  useGetBusinessSettings,
  useGetPublicReportBranding,
  getGetBusinessSettingsQueryKey,
  getGetPublicReportBrandingQueryKey,
  getGetPartyQueryKey,
  getListPartiesQueryKey,
  getListLedgerEntriesQueryKey,
  LedgerEntryType,
} from '@workspace/api-client-react';
import {
  ChevronLeft,
  Phone,
  FileText,
  Copy,
  Check,
  FileDown,
  MessageCircle,
  MessageSquareText,
  Plus,
  Loader2,
  ArrowLeftRight,
} from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { resolveLedgerBookName } from '@/lib/ledger-book-name';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TransactionEntryScreen } from '@/components/modals/transaction-entry-screen';
import { BillAttachmentPreview } from '@/components/bill-attachment-preview';
import {
  LedgerReportDocument,
  buildReportFilename,
  buildWhatsAppReminderText,
  toWhatsAppNumber,
  stampPageNumbers,
} from '@/lib/ledger-report';
import { billImageSrc, prefetchImagesForPdf } from '@/lib/billImageStorage';
import { toast } from 'sonner';
import { differenceInCalendarDays, format } from 'date-fns';
import { formatLedgerEntryDateTime, getLedgerEntryDateKey } from '@/lib/date-time';
import { useAppAuth } from '@/App';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import { ENTRY_OUTBOX_CHANGED, listEntries, type QueuedEntry } from '@/lib/entryOutbox';
import { mergeLedgerEntries, projectPartyBalance, queuedEntriesForParty } from '@/lib/offline-ledger-projection';
import { shareGeneratedFileWithNative } from '@/lib/native-file-export';
import { addPdfLinkAnnotations } from '@/lib/pdf-link-annotations';
import { splitAdjustmentDescription } from '@/lib/adjustment-display';

/**
 * The entry's real transaction date. Users can backdate/forward-date an
 * entry via the date field in the transaction entry screen (stored as
 * `dueDate`); fall back to the entry's insertion date only when unset.
 */
function entryDateKey(entry: { dueDate: string | null; createdAt: string | Date }) {
  return getLedgerEntryDateKey(entry.dueDate, entry.createdAt);
}

function currencyAmountColumnWidth(viewportWidth: number): number {
  if (viewportWidth < 380) return 80;
  if (viewportWidth < 480) return 88;
  return 96;
}

function currencyAmountFontSize(value: string, columnWidth: number): string {
  const estimatedWidthInEm = Array.from(value).reduce((width, character) => {
    if (character === '৳') return width + 0.9;
    if (character === ',' || character === '.') return width + 0.35;
    return width + 0.68;
  }, 0);

  const availableWidth = columnWidth - 8;
  const maxFontSize = columnWidth < 80 ? 11 : columnWidth < 96 ? 12 : 14;
  return `${Math.min(maxFontSize, availableWidth / (estimatedWidthInEm * 1.12))}px`;
}

function balanceBadgeFontSize(value: string, availableWidth: number): string {
  const estimatedWidthInEm = Array.from(value).reduce((width, character) => {
    if (character === '৳') return width + 0.9;
    if (character === ',' || character === '.') return width + 0.35;
    if (/[0-9০-৯]/.test(character)) return width + 0.68;
    if (/\s/.test(character)) return width + 0.3;
    return width + 0.55;
  }, 0);

  return `${Math.min(10, availableWidth / (estimatedWidthInEm * 1.12))}px`;
}

const bengaliIntegerFormatter = new Intl.NumberFormat('bn-BD', { useGrouping: false });

function relativeLedgerDate(date: Date): string {
  const dayDifference = differenceInCalendarDays(new Date(), date);
  if (dayDifference === 0) return 'আজ';
  const dayCount = bengaliIntegerFormatter.format(Math.abs(dayDifference));
  return dayDifference > 0 ? `${dayCount} দিন আগে` : `${dayCount} দিন পরে`;
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
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? 768 : window.innerWidth
  ));
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);
  const amountColumnWidth = currencyAmountColumnWidth(viewportWidth);
  const { role: userRole, userId } = useAppAuth();
  const { selectedBusinessId, businesses } = useBusinessContext();
  const [pendingEntries, setPendingEntries] = useState<QueuedEntry[]>([]);
  useEffect(() => {
    setPendingEntries([]);
    if (!userId || !id) return;
    let active = true;
    const refresh = () => {
      void listEntries(userId, selectedBusinessId).then((items) => {
        if (active) setPendingEntries(queuedEntriesForParty(items, id));
      }).catch(() => {});
    };
    refresh();
    window.addEventListener(ENTRY_OUTBOX_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(ENTRY_OUTBOX_CHANGED, refresh);
    };
  }, [userId, selectedBusinessId, id]);

  const { data: party, isLoading: partyLoading } = useGetParty(id || '', { query: { enabled: !!id, queryKey: businessScopedQueryKey(getGetPartyQueryKey(id || ''), selectedBusinessId) } });
  const { data: serverEntries = [], isLoading: entriesLoading } = useListLedgerEntries(id || '', { query: { enabled: !!id, queryKey: businessScopedQueryKey(getListLedgerEntriesQueryKey(id || ''), selectedBusinessId) } });
  const { data: settings } = useGetBusinessSettings({ query: { enabled: userRole === 'owner', queryKey: businessScopedQueryKey(getGetBusinessSettingsQueryKey(), selectedBusinessId) } });
  const { data: reportBranding } = useGetPublicReportBranding({
    query: {
      queryKey: getGetPublicReportBrandingQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const partiesParams = {};
  const { data: allParties = [] } = useListParties(partiesParams, {
    query: { queryKey: businessScopedQueryKey(getListPartiesQueryKey(partiesParams), selectedBusinessId) },
  });
  const partyNameMap = useMemo(() => Object.fromEntries(allParties.map(p => [p.id, p.name])), [allParties]);

  const [transactionType, setTransactionType] = useState<LedgerEntryType | null>(null);
  const [smsMessage, setSmsMessage] = useState<string | null>(null);
  const [copiedSms, setCopiedSms] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingReminder, setIsGeneratingReminder] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const activeBusinessName = businesses.find((business) => business.id === selectedBusinessId)?.name;
  const storeName = resolveLedgerBookName(activeBusinessName, settings?.storeName) ?? 'Banglakhata';
  const entries = useMemo(
    () => mergeLedgerEntries(serverEntries, pendingEntries, id ?? ''),
    [serverEntries, pendingEntries, id],
  );
  const queuedEntryIds = useMemo(
    () => new Set(pendingEntries.flatMap((entry) => entry.status === 'pending' ? [
      entry.id,
      ...(entry.data.isTransfer ? [`offline-transfer-counterpart:${entry.id}`] : []),
    ] : [])),
    [pendingEntries],
  );
  const displayParty = useMemo(
    () => party ? projectPartyBalance(party, pendingEntries) : undefined,
    [party, pendingEntries],
  );

  // Reconstruct balances chronologically, then show the live history and PDFs
  // newest-first. The PDF renderer keeps these per-entry balance snapshots.
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
    if (!displayParty) return [] as (typeof entries[number] & { balanceAfter: number })[];
    const signedDelta = (entry: (typeof entries)[number]) => (entry.type === 'YOU_GAVE' ? entry.amount : -entry.amount);
    const signedCurrent = displayParty.balanceType === 'YOU_WILL_GET'
      ? displayParty.currentBalance
      : -displayParty.currentBalance;
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
  }, [entries, displayParty]);

  const descendingEntries = useMemo(() => [...ascendingEntries].reverse(), [ascendingEntries]);

  const groupedEntries = useMemo(() => groupByDay(descendingEntries), [descendingEntries]);

  /** Renders the hidden report DOM node into a jsPDF worker instance. */
  const buildReportPdf = (html2pdf: typeof import('html2pdf.js').default) => {
    if (!reportRef.current) return null;
    return html2pdf().set({
      margin: 10,
      filename: party ? buildReportFilename(party.name) : 'Banglakhata_Ledger.pdf',
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
        if (reportRef.current) addPdfLinkAnnotations(pdf, reportRef.current);
      }) as unknown as NonNullable<ReturnType<typeof buildReportPdf>>;

  const handleReport = async () => {
    if (!party || !reportRef.current) return;
    setIsGeneratingReport(true);
    let restore: (() => void) | null = null;
    try {
      // Pre-fetch all cloud bill images into base64 so html2canvas can render
      // them even when the device is offline or the API is temporarily down.
      const { restore: restoreFn, failedCount } = await prefetchImagesForPdf(reportRef.current);
      restore = restoreFn;

      if (failedCount > 0) {
        toast.warning(
          `${failedCount}টি বিলের ছবি লোড করা যায়নি — সেগুলো পিডিএফে দেখাবে না`,
          { duration: 5000 }
        );
      }

      const { default: html2pdf } = await import('html2pdf.js');
      const worker = buildReportPdf(html2pdf);
      if (!worker) throw new Error('report element not ready');
      const finalizedWorker = finalizeReportPdf(worker);
      const blob = await finalizedWorker.outputPdf('blob');
      const filename = buildReportFilename(party.name);
      const nativeShare = await shareGeneratedFileWithNative(blob, {
        fileName: filename,
        mimeType: 'application/pdf',
        title: `${party.name} এর হিসাবের রিপোর্ট`,
      });
      if (!nativeShare) await finalizedWorker.save(filename);
      // Silent by design: the browser's own download indicator is the
      // confirmation — on mobile the system share sheet is the confirmation.
    } catch (err) {
      console.error('Report generation failed', err);
    } finally {
      restore?.();
      setIsGeneratingReport(false);
    }
  };

  const handleReminderShare = async () => {
    if (!party || !reportRef.current) return;
    setIsGeneratingReminder(true);
    let restore: (() => void) | null = null;
    try {
      // Pre-fetch all cloud bill images into base64 so html2canvas can render
      // them even when the device is offline or the API is temporarily down.
      const { restore: restoreFn, failedCount } = await prefetchImagesForPdf(reportRef.current);
      restore = restoreFn;

      if (failedCount > 0) {
        toast.warning(
          `${failedCount}টি বিলের ছবি লোড করা যায়নি — সেগুলো পিডিএফে দেখাবে না`,
          { duration: 5000 }
        );
      }

      const { default: html2pdf } = await import('html2pdf.js');
      const worker = buildReportPdf(html2pdf);
      if (!worker) throw new Error('report element not ready');
      const blob = await finalizeReportPdf(worker).outputPdf('blob');
      const filename = buildReportFilename(party.name);
      const messageText = buildWhatsAppReminderText(storeName, party);
      const nativeShare = await shareGeneratedFileWithNative(blob, {
        fileName: filename,
        mimeType: 'application/pdf',
        title: 'হিসাবের রিপোর্ট',
        shareText: messageText,
      });

      if (nativeShare) {
        toast.success(
          nativeShare.copiedText
            ? 'রিমাইন্ডারের লেখা কপি হয়েছে—WhatsApp-এ গিয়ে পেস্ট করুন'
            : 'রিপোর্ট PDF শেয়ার করার জন্য প্রস্তুত',
        );
        return;
      }

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
        // Silent by design: the native share sheet opening is itself the
        // confirmation — no toast needed.
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
      // Silent by design: opening WhatsApp / triggering the download is
      // itself the confirmation — no toast needed.
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled the native share sheet — not an error.
        return;
      }
      console.error('Reminder share failed', err);
    } finally {
      restore?.();
      setIsGeneratingReminder(false);
    }
  };

  const handleSms = () => {
    if (!party) return;
    const label = party.balanceType === 'YOU_WILL_GET' ? 'আপনি পাবেন' : 'আপনি দেবেন';
    setSmsMessage(
      `প্রিয় ${party.name}, আপনার হিসাবে ${label} ${formatCurrency(displayParty?.currentBalance ?? party.currentBalance)}। ধন্যবাদান্তে, Banglakhata।`
    );
    setCopiedSms(false);
  };

  const handleCopySms = async () => {
    if (!smsMessage) return;
    try {
      await navigator.clipboard.writeText(smsMessage);
      // `copiedSms` already drives the button's own "কপি হয়েছে" label/icon
      // swap below — that's the (silent, instant) confirmation.
      setCopiedSms(true);
      setTimeout(() => setCopiedSms(false), 2000);
    } catch (err) {
      console.error('Clipboard copy failed', err);
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

  const isGive = displayParty?.balanceType === 'YOU_WILL_GIVE';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#f8fafc] w-full relative">
      {/* Sticky blue top header */}
      <div className="bg-[#0b57d0] shadow-sm z-10 shrink-0 sticky top-0">
        <div className="flex items-center gap-3 px-3 pb-6 pt-[calc(0.75rem+var(--safe-top))]">
          <Link
            href="/"
            aria-label="পিছনে যান"
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </Link>
          {/* Avatar + name — tap to open the profile screen (owner only) */}
          <button
            type="button"
            onClick={() => {
              if (userRole === 'owner') navigate(`/party/${id}/profile`);
            }}
            className={cn("flex items-center gap-3 flex-1 min-w-0 transition-all", userRole === 'owner' ? "active:opacity-75 cursor-pointer" : "cursor-default")}
          >
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 text-[#0b57d0]">
              <Plus className="w-5 h-5" strokeWidth={3} />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-extrabold text-white leading-tight truncate">{party.name}</h2>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/20 text-white uppercase tracking-wider shrink-0">
                  {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
                </span>
              </div>
            </div>
          </button>
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
            {formatCurrency(displayParty?.currentBalance ?? party.currentBalance)}
          </p>
        </div>
      </div>

      {/* Action buttons bar */}
      {userRole === 'owner' && (
        <div className="bg-white mt-3 shrink-0 border-b border-slate-200 grid grid-cols-3 divide-x divide-slate-100">
          <button
            type="button"
            onClick={() => navigate(`/party/${id}/report`)}
            className="flex flex-col items-center gap-1 py-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <FileDown className="w-5 h-5 text-slate-500" />
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
      )}

      {/* Scrollable ledger area */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F5F6F8] pb-4">
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
            <div className="sticky top-0 z-[5] grid grid-cols-[minmax(0,1fr)_5rem_5rem] min-[380px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] min-[480px]:grid-cols-[minmax(0,1fr)_6rem_6rem] bg-[#F5F6F8] px-1.5 py-2 text-[8px] font-bold uppercase tracking-wider text-slate-500 min-[480px]:px-3 min-[480px]:text-[10px]">
              <span>এন্ট্রি</span>
              <span className="min-w-0 px-1 text-center leading-tight text-red-500">আপনি দিয়েছেন</span>
              <span className="min-w-0 px-1 text-right leading-tight text-emerald-500">আপনি পেয়েছেন</span>
            </div>

            {groupedEntries.map((group) => (
              <div key={group.dayKey}>
                <div className="sticky top-[26px] z-[4] flex justify-center bg-[#F5F6F8]/95 py-1.5 backdrop-blur-sm">
                  <span className="text-[11px] font-semibold tracking-wide text-slate-500">
                    {format(group.date, 'd MMM yy')} • {relativeLedgerDate(group.date)}
                  </span>
                </div>
                <div className="space-y-2 px-1.5 min-[480px]:px-2.5">
                  {group.items.map((entry, i) => {
                    const isGave = entry.type === 'YOU_GAVE';
                    const isQueuedLocally = queuedEntryIds.has(entry.id);
                    const imgSrc = billImageSrc(entry.billImage);
                    const transferPartyName = entry.transferPartyId
                      ? partyNameMap[entry.transferPartyId]
                      : '';
                    const entryDisplay = splitAdjustmentDescription(
                      entry.description,
                      entry.isTransfer,
                      transferPartyName,
                    );
                    const formattedAmount = formatCurrency(entry.amount);
                    const amountFontSize = currencyAmountFontSize(formattedAmount, amountColumnWidth);
                    const formattedBalance = formatCurrency(Math.abs(entry.balanceAfter));
                    const balanceAvailableWidth = Math.max(40, viewportWidth - 38 - (2 * amountColumnWidth));
                    const balanceFontSize = balanceBadgeFontSize(
                      `ব্যালেন্স: ${formattedBalance}`,
                      balanceAvailableWidth,
                    );
                    return (
                      <div
                        key={entry.id}
                        data-entry-card
                        role={userRole === 'owner' ? "button" : undefined}
                        tabIndex={userRole === 'owner' ? 0 : undefined}
                        onClick={() => {
                          if (userRole === 'owner') navigate(`/party/${id}/entry/${entry.id}`);
                        }}
                        onKeyDown={(e) => {
                          if (userRole === 'owner' && e.key === 'Enter') navigate(`/party/${id}/entry/${entry.id}`);
                        }}
                        className={cn(
                          "grid grid-cols-[minmax(0,1fr)_5rem_5rem] min-[380px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] min-[480px]:grid-cols-[minmax(0,1fr)_6rem_6rem] items-stretch gap-0 overflow-hidden rounded-xl border border-[#EBEBEB] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.07)] animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both transition-colors",
                            userRole === 'owner' ? "cursor-pointer active:bg-slate-50" : ""
                        )}
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <div className="min-w-0 py-2.5 pl-2 pr-1 min-[480px]:py-3 min-[480px]:pl-3 min-[480px]:pr-2">
                          <p className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-slate-700 min-[480px]:gap-1.5 min-[480px]:text-[12px]">
                            {formatLedgerEntryDateTime(entry.dueDate, entry.createdAt)}
                            {entry.isTransfer && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 text-[9px] font-bold">
                                <ArrowLeftRight className="w-2.5 h-2.5" />ট্রান্সফার
                              </span>
                            )}
                          </p>
                          <span className={cn(
                            'mt-1 inline-flex max-w-full flex-nowrap items-center whitespace-nowrap rounded-md px-1 py-0.5 text-[8px] font-semibold leading-snug min-[380px]:text-[9px] min-[480px]:px-1.5 min-[480px]:text-[10px]',
                            entry.balanceAfter >= 0
                              ? 'bg-[#EAF4F1] text-emerald-800'
                              : 'bg-[#FFF0F0] text-red-700',
                          )} style={{ fontSize: balanceFontSize }}>
                            <span className="shrink-0">ব্যালেন্স:</span>
                            <span className="ml-1 min-w-0 whitespace-nowrap">
                              {formattedBalance}
                            </span>
                          </span>
                          {entryDisplay.details && (
                            <p className="mt-1 whitespace-pre-wrap break-words text-[10px] font-semibold leading-snug text-slate-500 min-[480px]:text-[11px]">
                              {entryDisplay.details}
                            </p>
                          )}
                          {entry.isTransfer && (
                            <p className={cn(
                              'mt-1 flex min-w-0 items-start gap-1 whitespace-normal break-words text-[10px] font-bold leading-snug min-[480px]:text-[11px]',
                              isGave ? 'text-red-500' : 'text-emerald-500',
                            )}>
                              <ArrowLeftRight className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="min-w-0">
                                {isGave ? 'আমি দিয়েছি' : 'আমি পেয়েছি'}
                                {transferPartyName ? ` — ${transferPartyName}` : ''}
                              </span>
                            </p>
                          )}
                          {entry.billReference && (
                            <span className="inline-block mt-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                              বিল: {entry.billReference}
                            </span>
                          )}
                          {imgSrc && (
                            <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                              <BillAttachmentPreview
                                src={imgSrc}
                                alt="সংযুক্ত বিল"
                                className="h-10 w-10 active:scale-95 transition-transform"
                                imageClassName="h-full w-full object-cover"
                              />
                            </div>
                          )}
                        </div>
                        {/* You-gave amounts occupy the debit column; tint it only when populated. */}
                        <div className={cn(
                          'min-w-0 flex items-center justify-end px-0.5 py-2.5 min-[480px]:px-1 min-[480px]:py-3',
                          isGave && 'bg-[#FFF5F5]',
                        )}>
                          {isGave && (
                            <span
                              className="block w-full min-w-0 whitespace-nowrap text-right font-extrabold leading-tight text-red-700"
                              style={{ fontSize: amountFontSize }}
                            >
                              {formattedAmount}
                            </span>
                          )}
                        </div>
                        {/* You-got amounts occupy the credit column; tint it only when populated. */}
                        <div className={cn(
                          'min-w-0 flex items-center justify-end px-0.5 py-2.5 min-[480px]:px-1 min-[480px]:py-3',
                          !isGave && 'bg-[#F0F8F5]',
                        )}>
                          {!isGave && (
                            <span
                              className="block w-full min-w-0 whitespace-nowrap text-right font-extrabold leading-tight text-emerald-700"
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
              </div>
            ))}
          </>
        )}
      </div>

      {/* Sticky bottom action overlay */}
      <div className="party-transaction-actions bg-white border-t border-slate-200 px-3 pt-3 flex gap-3 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] shrink-0 z-20">
        <Button
          variant="destructive"
          className="flex-1 h-12 text-base font-extrabold shadow-[0_4px_14px_0_rgba(239,68,68,0.35)] active:scale-[0.98] transition-all rounded-xl flex items-center justify-center leading-none"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GAVE)}
        >
          আপনি দিয়েছেন ৳
        </Button>
        <Button
          variant="success"
          className="flex-1 h-12 text-base font-extrabold shadow-[0_4px_14px_0_rgba(16,185,129,0.35)] active:scale-[0.98] transition-all rounded-xl flex items-center justify-center leading-none"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GOT)}
        >
          আপনি পেয়েছেন ৳
        </Button>
      </div>

      {transactionType && (
        <TransactionEntryScreen
          partyId={id}
          partyName={party.name}
          partyRole={party.role}
          type={transactionType}
          onClose={() => setTransactionType(null)}
        />
      )}

      {/* Off-screen printable ledger report used to render the actual PDF via html2pdf */}
      <div style={{ position: 'fixed', left: '-9999px', top: 0, zIndex: -1 }} aria-hidden="true">
        <LedgerReportDocument
          ref={reportRef}
          storeName={storeName}
          party={displayParty ?? party}
          entries={ascendingEntries.map((entry) => ({
            ...entry,
            transferPartyName: entry.transferPartyId ? partyNameMap[entry.transferPartyId] ?? null : null,
          }))}
          supportPhone={reportBranding?.supportPhone}
          supportEmail={reportBranding?.supportEmail}
          playStoreUrl={reportBranding?.playStoreUrl}
          appleStoreUrl={reportBranding?.appleStoreUrl}
        />
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

    </div>
  );
}
