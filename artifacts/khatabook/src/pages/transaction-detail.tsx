import { useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetParty,
  useListLedgerEntries,
  useGetBusinessSettings,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
  type LedgerEntry,
  type Party,
  type DashboardSummary,
} from '@workspace/api-client-react';
import {
  ChevronLeft,
  Trash2,
  Share2,
  Cloud,
  CheckCircle2,
  Receipt,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { billImageSrc } from '@/lib/billImageStorage';
import { toWhatsAppNumber } from '@/lib/ledger-report';
import { BillImageLightbox } from '@/components/modals/bill-image-lightbox';
import { applyBalanceDelta, shiftSummaryForPartyChange } from '@/lib/optimistic';
import { toast } from 'sonner';
import { generateReceiptBlob } from '@/lib/receiptCanvas';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function entryDateKey(entry: { dueDate: Date | string | null; createdAt: Date | string }) {
  return format(new Date((entry.dueDate as string) || (entry.createdAt as string)), 'yyyy-MM-dd');
}

export function TransactionDetailPage() {
  const [, params] = useRoute('/party/:partyId/entry/:entryId');
  const partyId = params?.partyId ?? '';
  const entryId = params?.entryId ?? '';
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: party, isLoading: partyLoading } = useGetParty(partyId, {
    query: { enabled: !!partyId, queryKey: getGetPartyQueryKey(partyId) },
  });
  const { data: entries = [], isLoading: entriesLoading } = useListLedgerEntries(partyId, {
    query: { enabled: !!partyId, queryKey: getListLedgerEntriesQueryKey(partyId) },
  });
  const { data: settings } = useGetBusinessSettings();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const entry = entries.find((e) => e.id === entryId);
  const storeName = settings?.storeName || 'ডিজিটাল খাতা';
  const isGave = entry?.type === 'YOU_GAVE';
  const imageSrc = billImageSrc(entry?.billImage ?? null);
  const partyInitials = (party?.name ?? '??').slice(0, 2).toUpperCase();

  const txDateKey = entry ? entryDateKey(entry) : '';
  const transactionDate = txDateKey ? format(new Date(`${txDateKey}T00:00:00`), 'd MMM yyyy') : '';
  const transactionTime = entry ? format(new Date(entry.createdAt as string), 'hh:mm a') : '';

  function buildReceiptText(): string {
    if (!party || !entry) return '';
    const actionLabel = isGave ? 'দিয়েছেন' : 'পেয়েছেন';
    const balanceLabel = party.balanceType === 'YOU_WILL_GET' ? 'পাবেন' : 'দেবেন';
    const lines = [
      '━━━━━━━━━━━━━━━━━━',
      `${storeName} — লেনদেন স্লিপ`,
      '━━━━━━━━━━━━━━━━━━',
      `গ্রাহক: ${party.name}`,
      `তারিখ: ${transactionDate} ${transactionTime}`,
      `লেনদেন: আপনি ${actionLabel} ${formatCurrency(entry.amount)}`,
      entry.description ? `নোট: ${entry.description}` : null,
      `বর্তমান ব্যালেন্স: ${formatCurrency(party.currentBalance)} (আপনি ${balanceLabel})`,
      '━━━━━━━━━━━━━━━━━━',
      'ডিজিটাল খাতা দ্বারা তৈরি',
    ];
    return lines.filter(Boolean).join('\n');
  }

  /**
   * Optimistic delete — 0ms navigation, background network request.
   *
   * Pattern:
   *   1. Snapshot all affected caches for rollback.
   *   2. Apply the expected post-delete state to the caches synchronously
   *      (removes the entry, reverses its balance delta).
   *   3. Close the dialog and navigate back to the party ledger instantly.
   *   4. Fire the DELETE request silently in the background.
   *   5. On success: background invalidation reconciles with server truth.
   *   6. On failure: restore the snapshots and show a non-blocking toast.
   */
  function handleDelete() {
    if (!partyId || !entryId || !party || !entry) return;

    const entriesKey = getListLedgerEntriesQueryKey(partyId);
    const partyKey = getGetPartyQueryKey(partyId);
    const partiesKey = getListPartiesQueryKey();
    const summaryKey = getGetDashboardSummaryQueryKey();

    // ── 1. Snapshot ───────────────────────────────────────────────────────
    const previousEntries = queryClient.getQueryData<LedgerEntry[]>(entriesKey);
    const previousParty = queryClient.getQueryData<Party>(partyKey);
    const previousParties = queryClient.getQueryData<Party[]>(partiesKey);
    const previousSummary = queryClient.getQueryData<DashboardSummary>(summaryKey);

    // ── 2. Optimistic cache updates ───────────────────────────────────────
    // Remove this entry from the list.
    queryClient.setQueryData<LedgerEntry[]>(entriesKey, (old) =>
      (old ?? []).filter((e) => e.id !== entryId),
    );

    // Reverse the entry's balance delta on the party.
    // YOU_GAVE originally applied +amount; reversal applies -amount.
    // YOU_GOT  originally applied -amount; reversal applies +amount.
    const reverseDelta = entry.type === 'YOU_GAVE' ? -entry.amount : entry.amount;
    const updatedParty = applyBalanceDelta(party, reverseDelta);

    queryClient.setQueryData<Party>(partyKey, updatedParty);
    queryClient.setQueryData<Party[]>(partiesKey, (old) =>
      (old ?? []).map((p) => (p.id === partyId ? applyBalanceDelta(p, reverseDelta) : p)),
    );
    if (previousSummary) {
      queryClient.setQueryData<DashboardSummary>(
        summaryKey,
        shiftSummaryForPartyChange(previousSummary, party, updatedParty),
      );
    }

    // ── 3. Close dialog + instant navigation ─────────────────────────────
    setShowDeleteConfirm(false);
    navigate(`/party/${partyId}`, { replace: true });

    // ── 4. Background DELETE request ─────────────────────────────────────
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/parties/${partyId}/entries/${entryId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // ── 5. Background reconciliation ──────────────────────────────────
        // Replace the optimistic state with the server's authoritative truth.
        queryClient.invalidateQueries({ queryKey: entriesKey });
        queryClient.invalidateQueries({ queryKey: partyKey });
        queryClient.invalidateQueries({ queryKey: partiesKey });
        queryClient.invalidateQueries({ queryKey: summaryKey });
      } catch (err) {
        console.error('Delete entry failed, rolling back:', err);

        // ── 6. Rollback on failure ────────────────────────────────────────
        queryClient.setQueryData(entriesKey, previousEntries);
        queryClient.setQueryData(partyKey, previousParty);
        queryClient.setQueryData(partiesKey, previousParties);
        queryClient.setQueryData(summaryKey, previousSummary);
        toast.error('মুছতে সমস্যা হয়েছে — লেনদেন ফিরে এসেছে');
      }
    })();
  }

  /**
   * Share pipeline:
   *  1. Render receipt to PNG via Canvas.
   *  2. Try Web Share API with files (WhatsApp, Imo, Messenger, SMS, etc.)
   *  3. Fallback: Web Share API text-only (opens share sheet without image).
   *  4. Fallback: trigger browser download of the PNG.
   */
  async function handleShare() {
    if (!party || !entry) return;
    setIsSharing(true);
    try {
      const blob = await generateReceiptBlob({
        storeName:      storeName,
        partyName:      party.name,
        date:           transactionDate,
        time:           transactionTime,
        amount:         entry.amount,
        isGave:         isGave,
        balance:        party.currentBalance,
        balanceIsGet:   party.balanceType === 'YOU_WILL_GET',
        description:    entry.description ?? undefined,
        billReference:  entry.billReference ?? undefined,
        base:           BASE,
      });

      const file = new File([blob], 'digital-khata-receipt.png', { type: 'image/png' });

      // ── tier 1: native share WITH image file ─────────────────────────────
      if (
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            files: [file],
            title: `${storeName} — লেনদেন স্লিপ`,
            text:  `${party.name} — ${formatCurrency(entry.amount)}`,
          });
          return;
        } catch (shareErr: unknown) {
          const e = shareErr as { name?: string };
          if (e?.name === 'AbortError') return; // user dismissed — don't fall through
          // other error → try next tier
        }
      }

      // ── tier 2: native share WITHOUT files (text + object URL) ───────────
      if (typeof navigator.share === 'function') {
        const objUrl = URL.createObjectURL(blob);
        try {
          await navigator.share({
            title: `${storeName} — লেনদেন স্লিপ`,
            text:  buildReceiptText(),
            url:   objUrl,
          });
          return;
        } catch (shareErr: unknown) {
          const e = shareErr as { name?: string };
          if (e?.name === 'AbortError') return;
          // fall through to download
        } finally {
          URL.revokeObjectURL(objUrl);
        }
      }

      // ── tier 3: download the PNG (desktop / unsupported browsers) ────────
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = 'digital-khata-receipt.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      toast.success('রসিদ ডাউনলোড হয়েছে');
    } catch (err: unknown) {
      console.error('Receipt generation failed:', err);
      // ── final fallback: WhatsApp text link ────────────────────────────────
      const text     = buildReceiptText();
      const waNumber = party.phone ? toWhatsAppNumber(party.phone) : '';
      const encoded  = encodeURIComponent(text);
      const url = waNumber
        ? `https://wa.me/${waNumber}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setIsSharing(false);
    }
  }

  // Loading skeleton
  if (partyLoading || entriesLoading) {
    return (
      <div className="flex flex-col h-[100dvh] bg-[#f8fafc]">
        <div className="h-14 bg-white border-b border-slate-200 animate-pulse" />
        <div className="flex-1 p-4 space-y-3">
          <div className="h-44 bg-white rounded-2xl animate-pulse" />
          <div className="h-8 bg-white rounded-full animate-pulse w-36" />
          <div className="h-36 bg-white rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Not found
  if (!entry || !party) {
    return (
      <div className="flex flex-col h-[100dvh] bg-[#f8fafc] items-center justify-center gap-4 px-6">
        <p className="text-slate-500 font-semibold text-center">এন্ট্রিটি পাওয়া যায়নি</p>
        <Button variant="outline" onClick={() => navigate(partyId ? `/party/${partyId}` : '/')}>
          ফিরে যান
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-[#f8fafc] overflow-hidden">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => navigate(`/party/${partyId}`)}
          className="p-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="ফিরে যান"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="text-[15px] font-bold text-slate-800 tracking-tight flex-1">
          বিস্তারিত প্রবেশিকা
        </h1>
      </header>

      {/* ── Scrollable body ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-3">

        {/* Main transaction card */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {/* Coloured banner */}
          <div className={cn('px-5 py-4', isGave ? 'bg-red-50' : 'bg-emerald-50')}>
            <div className="flex items-center gap-4">
              <div className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-[17px] shrink-0',
                isGave ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700',
              )}>
                {partyInitials}
              </div>
              <div className="min-w-0">
                <p className="font-extrabold text-slate-800 text-base leading-tight truncate">
                  {party.name}
                </p>
                <p className="text-[12px] text-slate-500 font-medium mt-0.5">
                  {transactionDate} • {transactionTime}
                </p>
              </div>
            </div>
          </div>

          {/* Amounts row */}
          <div className="px-5 py-4 grid grid-cols-2 gap-4 border-t border-slate-100">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                {isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন'}
              </p>
              <p className={cn('text-2xl font-extrabold', isGave ? 'text-red-600' : 'text-emerald-600')}>
                {formatCurrency(entry.amount)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                বর্তমান ব্যালেন্স
              </p>
              <p className={cn(
                'text-2xl font-extrabold',
                party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-600',
              )}>
                {formatCurrency(party.currentBalance)}
              </p>
              <p className={cn(
                'text-[11px] font-semibold mt-0.5',
                party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-500' : 'text-red-500',
              )}>
                {party.balanceType === 'YOU_WILL_GET' ? 'আপনি পাবেন' : 'আপনি দেবেন'}
              </p>
            </div>
          </div>
        </div>

        {/* Status pills */}
        {(entry.billReference || entry.billImage) && (
          <div className="flex items-center gap-2 flex-wrap">
            {entry.billReference && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                বিল: {entry.billReference}
              </span>
            )}
            {entry.billImage && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Cloud className="w-3 h-3" />
                ক্লাউডে সংরক্ষিত
              </span>
            )}
          </div>
        )}

        {/* Description */}
        {entry.description && (
          <div className="bg-white rounded-2xl shadow-sm px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">নোট</p>
            <p className="text-[14px] text-slate-700 font-medium leading-relaxed">{entry.description}</p>
          </div>
        )}

        {/* Bill image */}
        {imageSrc && (
          <div className="bg-white rounded-2xl shadow-sm px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              সংযুক্ত বিলের ছবি
            </p>
            <button
              type="button"
              onClick={() => setLightboxImage(imageSrc)}
              className="block w-full active:scale-[0.98] transition-transform"
            >
              <img
                src={imageSrc}
                alt="সংযুক্ত বিল"
                className="w-full max-h-64 object-contain rounded-xl border border-slate-200 bg-slate-50"
              />
              <p className="text-[11px] text-slate-400 font-medium mt-2 text-center">
                ছবি বড় করতে ট্যাপ করুন
              </p>
            </button>
          </div>
        )}

        {/* Digital receipt preview card */}
        <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-100">
          {/* Header */}
          <div className="bg-[#1B3A6B] px-5 py-4 flex flex-col items-center gap-1">
            <img
              src={`${BASE}/logo-icon.svg`}
              alt="ডিজিটাল খাতা"
              className="w-10 h-10 mb-1"
            />
            <p className="text-white font-extrabold text-[13px] tracking-tight">Digital Khata</p>
            <p className="text-white/65 text-[11px]">ডিজিটাল খাতা</p>
          </div>

          {/* Store name strip */}
          <div className="bg-[#243E72] px-5 py-2 text-center">
            <p className="text-white/88 text-[11px] font-semibold truncate">{storeName}</p>
          </div>

          {/* Amount banner */}
          <div className={cn('px-5 py-4 text-center', isGave ? 'bg-red-50' : 'bg-emerald-50')}>
            <p className={cn('text-[11px] font-semibold mb-0.5', isGave ? 'text-red-400' : 'text-emerald-400')}>
              {isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন'}
            </p>
            <p className={cn('text-3xl font-extrabold', isGave ? 'text-red-600' : 'text-emerald-600')}>
              {formatCurrency(entry.amount)}
            </p>
          </div>

          {/* Detail rows */}
          <div className="bg-slate-50 px-5 py-4 space-y-3 border-t border-slate-100">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">গ্রাহক</p>
              <p className="text-[14px] font-bold text-slate-800">{party.name}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">তারিখ ও সময়</p>
              <p className="text-[13px] font-semibold text-slate-600">{transactionDate} • {transactionTime}</p>
            </div>
            {entry.description && (
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">নোট</p>
                <p className="text-[13px] text-slate-600">{entry.description}</p>
              </div>
            )}

            {/* Balance row */}
            <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2">
              <div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">এই লেনদেন</p>
                <p className={cn('text-[15px] font-extrabold', isGave ? 'text-red-600' : 'text-emerald-600')}>
                  {formatCurrency(entry.amount)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">বর্তমান ব্যালেন্স</p>
                <p className={cn('text-[15px] font-extrabold',
                  party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-600',
                )}>
                  {formatCurrency(party.currentBalance)}
                </p>
                <p className={cn('text-[10px] font-semibold',
                  party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-500' : 'text-red-500',
                )}>
                  {party.balanceType === 'YOU_WILL_GET' ? 'আপনি পাবেন' : 'আপনি দেবেন'}
                </p>
              </div>
            </div>
          </div>

          {/* Footer safety badge */}
          <div className="bg-[#0f1d35] px-5 py-3 flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-[#F5A623] shrink-0 flex items-center justify-center">
              <CheckCircle2 className="w-3 h-3 text-[#0f1d35]" />
            </div>
            <p className="text-white/85 text-[11px] font-semibold">
              ১০০% নিরাপদ ও সুরক্ষিত ডিজিটাল খাতা
            </p>
          </div>

          {/* Share hint */}
          <div className="bg-white px-5 py-3 flex items-center gap-2 border-t border-slate-100">
            <ImageIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <p className="text-[11px] text-slate-400 font-medium">
              "শেয়ার করুন" বাটনে ট্যাপ করলে এই রসিদটি ছবি হিসেবে তৈরি হবে
            </p>
          </div>
        </div>
      </div>

      {/* ── Fixed footer ─────────────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 flex gap-3 px-4 py-4 bg-white border-t border-slate-200 z-20">
        <Button
          variant="outline"
          className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700 font-bold"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          মুছে ফেলুন
        </Button>
        <Button
          className="flex-1 bg-[#1B3A6B] hover:bg-[#243E72] font-bold"
          onClick={handleShare}
          disabled={isSharing}
        >
          {isSharing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              রসিদ তৈরি হচ্ছে…
            </>
          ) : (
            <>
              <Share2 className="w-4 h-4 mr-2" />
              শেয়ার করুন
            </>
          )}
        </Button>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>লেনদেন মুছে ফেলুন?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              এই লেনদেন মুছে গেলে <span className="font-semibold text-slate-800">{party.name}</span>-এর
              ব্যালেন্স আপডেট হয়ে যাবে। এটি পূর্বাবস্থায় ফেরানো যাবে না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-bold">বাতিল</AlertDialogCancel>
            <Button
              variant="destructive"
              className="font-bold"
              onClick={handleDelete}
            >
              মুছে ফেলুন
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lightbox */}
      {lightboxImage && (
        <BillImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
}
