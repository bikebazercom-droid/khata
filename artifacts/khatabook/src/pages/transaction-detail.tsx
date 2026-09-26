import { useRef, useState } from 'react';
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
  LedgerEntryType,
  type LedgerEntry,
  type Party,
  type DashboardSummary,
} from '@workspace/api-client-react';
import { ArrowRight } from 'lucide-react';
import { TransactionEntryScreen } from '@/components/modals/transaction-entry-screen';
import { ChevronLeft, Trash2, Cloud } from 'lucide-react';
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
import { BillImageLightbox } from '@/components/modals/bill-image-lightbox';
import { applyBalanceDelta, shiftSummaryForPartyChange } from '@/lib/optimistic';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';

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

  const entry = entries.find((e) => e.id === entryId);

  // Eagerly resolve the transfer party name once we have the entry
  const transferPartyId = entry?.transferPartyId ?? '';
  const { data: transferParty } = useGetParty(transferPartyId, {
    query: {
      enabled: !!(entry?.isTransfer && transferPartyId),
      queryKey: getGetPartyQueryKey(transferPartyId),
    },
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  // Ref for the shareable receipt card
  const receiptCardRef = useRef<HTMLDivElement>(null);
  const storeName = settings?.storeName || 'Banglakhata';
  const isGave = entry?.type === 'YOU_GAVE';
  const imageSrc = billImageSrc(entry?.billImage ?? null);

  const txDateKey = entry ? entryDateKey(entry) : '';
  const transactionDate = txDateKey ? format(new Date(`${txDateKey}T00:00:00`), 'd MMM yy') : '';
  const transactionTime = entry ? format(new Date(entry.createdAt as string), 'hh:mm a') : '';

  const balanceColor = party?.balanceType === 'YOU_WILL_GET' ? '#047857' : '#DC2626';
  const amountColor = isGave ? '#DC2626' : '#047857';
  const amountLabel = isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন';
  const smsText = `${amountLabel}: ৳ ${entry ? formatCurrency(entry.amount) : ''}\nব্যালেন্স: ৳ ${party ? formatCurrency(party.currentBalance) : ''}`;

  // ── Share: capture receipt card as JPG, open native share sheet ────────
  const handleJpgShare = async () => {
    if (!receiptCardRef.current || !entry || !party) return;
    try {
      const canvas = await html2canvas(receiptCardRef.current, {
        backgroundColor: '#ffffff',
        scale: 3,
        useCORS: true,
        logging: false,
      });
      const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.98);
      const filename = `Receipt_${entry.id}.jpg`;

      const byteStr = atob(jpgDataUrl.split(',')[1]);
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: 'image/jpeg' });
      const file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'লেনদেন রসিদ', text: 'Banglakhata থেকে পাঠানো রসিদ ছবি।' });
          return;
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return;
        }
      }
      // Fallback: download
      const a = document.createElement('a');
      a.href = jpgDataUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err) {
      console.error('Image rendering failed:', err);
    }
  };

  // ── Optimistic delete ──────────────────────────────────────────────────
  function handleDelete() {
    if (!partyId || !entryId || !party || !entry) return;

    const entriesKey = getListLedgerEntriesQueryKey(partyId);
    const partyKey   = getGetPartyQueryKey(partyId);
    const partiesKey = getListPartiesQueryKey();
    const summaryKey = getGetDashboardSummaryQueryKey();

    const previousEntries = queryClient.getQueryData<LedgerEntry[]>(entriesKey);
    const previousParty   = queryClient.getQueryData<Party>(partyKey);
    const previousParties = queryClient.getQueryData<Party[]>(partiesKey);
    const previousSummary = queryClient.getQueryData<DashboardSummary>(summaryKey);

    queryClient.setQueryData<LedgerEntry[]>(entriesKey, (old) =>
      (old ?? []).filter((e) => e.id !== entryId),
    );

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

    setShowDeleteConfirm(false);
    navigate(`/party/${partyId}`, { replace: true });

    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/parties/${partyId}/entries/${entryId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        queryClient.invalidateQueries({ queryKey: entriesKey });
        queryClient.invalidateQueries({ queryKey: partyKey });
        queryClient.invalidateQueries({ queryKey: partiesKey });
        queryClient.invalidateQueries({ queryKey: summaryKey });
      } catch (err) {
        console.error('Delete entry failed, rolling back:', err);
        queryClient.setQueryData(entriesKey, previousEntries);
        queryClient.setQueryData(partyKey, previousParty);
        queryClient.setQueryData(partiesKey, previousParties);
        queryClient.setQueryData(summaryKey, previousSummary);
        toast.error('মুছতে সমস্যা হয়েছে — লেনদেন ফিরে এসেছে');
      }
    })();
  }

  // ── Loading skeleton ───────────────────────────────────────────────────
  if (partyLoading || entriesLoading) {
    return (
      <div className="flex flex-col h-[100dvh] bg-[#F3F4F6]">
        <div className="h-14 bg-[#0052B4] animate-pulse" />
        <div className="flex-1 p-4 space-y-3">
          <div className="h-44 bg-white rounded-lg animate-pulse" />
          <div className="h-16 bg-white rounded-lg animate-pulse" />
          <div className="h-12 bg-white rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────
  if (!entry || !party) {
    return (
      <div className="flex flex-col h-[100dvh] bg-[#F3F4F6] items-center justify-center gap-4 px-6">
        <p className="text-slate-500 font-semibold text-center">এন্ট্রিটি পাওয়া যায়নি</p>
        <Button variant="outline" onClick={() => navigate(partyId ? `/party/${partyId}` : '/')}>
          ফিরে যান
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-[#F3F4F6] overflow-hidden" style={{ fontFamily: 'sans-serif' }}>

      {/* ── 1. Dark blue header ──────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center gap-4 px-4 py-3"
        style={{ backgroundColor: '#0052B4' }}
      >
        <button
          type="button"
          onClick={() => navigate(`/party/${partyId}`)}
          aria-label="ফিরে যান"
          className="p-1 -ml-1 rounded-lg active:bg-white/20 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
        <h1 className="text-[17px] font-bold text-white tracking-tight flex-1">
          বিস্তারিত প্রবেশিকা
        </h1>
      </header>

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 space-y-3">

        {/* ── 2. White receipt card (captured for share) ─────────── */}
        <div
          ref={receiptCardRef}
          className="bg-white rounded-lg overflow-hidden"
          style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }}
        >
          {/* Top row: avatar + phone/date | amount + label */}
          <div className="flex justify-between items-start px-5 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center shrink-0 text-white font-bold text-xl"
                style={{ backgroundColor: '#0A4384', width: 44, height: 44, borderRadius: '50%' }}
              >
                +
              </div>
              <div>
                <p className="text-[17px] font-bold text-[#1F2937] leading-tight">
                  {party.phone || party.name}
                </p>
                <p className="text-[13px] mt-0.5" style={{ color: '#6B7280' }}>
                  {transactionDate} • {transactionTime}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold" style={{ color: amountColor }}>
                ৳ {formatCurrency(entry.amount)}
              </p>
              <p className="text-[13px] mt-1" style={{ color: '#4B5563' }}>
                {amountLabel}
              </p>
            </div>
          </div>

          {/* Divider */}
          <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '0 20px' }} />

          {/* Balance row */}
          <div className="flex justify-between items-center px-5 py-4">
            <p className="text-[15px] font-medium" style={{ color: '#374151' }}>
              বর্তমান ব্যালেন্স
            </p>
            <p className="text-[18px] font-bold" style={{ color: balanceColor }}>
              ৳ {formatCurrency(party.currentBalance)}
            </p>
          </div>

          {/* Note (if any) */}
          {entry.description && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid #F3F4F6', margin: '0 20px' }} />
              <div className="px-5 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#9CA3AF' }}>নোট</p>
                <p className="text-[13px]" style={{ color: '#6B7280' }}>{entry.description}</p>
              </div>
            </>
          )}

          {/* Edit button — excluded from capture */}
          <div
            data-html2canvas-ignore="true"
            onClick={() => setIsEditOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditOpen(true)}
            className="flex items-center justify-center gap-2 px-5 py-3 cursor-pointer active:bg-slate-50 transition-colors"
            style={{ borderTop: '1px solid #F3F4F6', color: '#2563EB', fontSize: 15, fontWeight: 700 }}
          >
            🖊️ এন্ট্রি এডিট করুন
          </div>
        </div>

        {/* Bill image (outside receipt card, not captured) */}
        {imageSrc && (
          <div
            className="bg-white rounded-lg overflow-hidden"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
          >
            <p
              className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-widest"
              style={{ color: '#9CA3AF' }}
            >
              সংযুক্ত বিলের ছবি
            </p>
            <button
              type="button"
              onClick={() => setLightboxImage(imageSrc)}
              className="block w-full px-4 pb-3 active:scale-[0.98] transition-transform"
            >
              <img
                src={imageSrc}
                alt="সংযুক্ত বিল"
                className="w-full max-h-56 object-contain rounded-lg border border-slate-100 bg-slate-50"
              />
              <p className="text-[11px] text-slate-400 font-medium mt-1.5 text-center">
                ছবি বড় করতে ট্যাপ করুন
              </p>
            </button>
          </div>
        )}

        {/* ── Transfer / linked-party card ────────────────────────── */}
        {entry.isTransfer && transferPartyId && (
          <button
            type="button"
            onClick={() => { if (transferParty) navigate(`/party/${transferPartyId}`); }}
            disabled={!transferParty}
            className="w-full text-left bg-white rounded-lg overflow-hidden active:bg-blue-50 transition-colors"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #DBEAFE' }}
          >
            <div className="px-4 pt-3 pb-1">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
                কার সাথে অ্যাডজাস্ট?
              </p>
            </div>
            <div className="flex items-center justify-between px-4 pb-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex items-center justify-center shrink-0 text-white font-bold text-sm"
                  style={{ backgroundColor: '#3B82F6', width: 36, height: 36, borderRadius: '50%' }}
                >
                  {(transferParty?.name ?? '…').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: '#1F2937' }}>
                    {transferParty?.name ?? entry.description ?? '…'}
                  </p>
                  {transferParty?.phone && (
                    <p className="text-[12px]" style={{ color: '#6B7280' }}>{transferParty.phone}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1" style={{ color: '#2563EB' }}>
                <span className="text-[13px] font-semibold">{transferParty ? 'খাতা দেখুন' : 'খাতা দেখার অনুমতি নেই'}</span>
                {transferParty && <ArrowRight className="w-4 h-4" />}
              </div>
            </div>
          </button>
        )}

        {/* ── 3. Info block 1: SMS status ─────────────────────────── */}
        <div
          className="bg-white rounded-lg px-4 py-4"
          style={{ border: '1px solid #E5E7EB' }}
        >
          <p className="font-bold flex items-center gap-1.5 text-[14px]" style={{ color: '#DC2626' }}>
            📢 SMS পাঠানো হয়নি
          </p>
          <p className="text-[14px] mt-2.5" style={{ color: '#4B5563' }}>
            {amountLabel}: ৳ {formatCurrency(entry.amount)}
          </p>
          <p className="text-[14px] mt-1" style={{ color: '#4B5563' }}>
            ব্যালেন্স: ৳ {formatCurrency(party.currentBalance)}
          </p>
          <p
            className="text-[13px] mt-1.5 break-all"
            style={{ color: '#9CA3AF' }}
          >
            {typeof window !== 'undefined' ? window.location.origin : ''}{BASE}/party/{partyId}
          </p>
        </div>

        {/* ── Info block 2: backup status ─────────────────────────── */}
        <div
          className="bg-white rounded-lg px-4 py-3.5 flex items-center gap-2 text-[14px]"
          style={{ border: '1px solid #E5E7EB', color: '#4B5563' }}
        >
          <Cloud className="w-4 h-4 shrink-0" style={{ color: '#60A5FA' }} />
          ☁️ এন্ট্রি ব্যাক আপ করা হয়েছে
        </div>

        {/* ── Trust badge ──────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-1.5 py-2" style={{ color: '#10B981', fontWeight: 600, fontSize: 14 }}>
          🛡️ 100% নিরাপদ ও সুরক্ষিত
        </div>
      </div>

      {/* ── 4. Fixed footer: Delete (left) + Share (right) ──────── */}
      <div
        className="fixed bottom-0 inset-x-0 flex gap-3 px-4 py-3 z-20"
        style={{ backgroundColor: '#ffffff', borderTop: '1px solid #E5E7EB', boxSizing: 'border-box' }}
      >
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded font-bold text-[15px] active:scale-[0.97] transition-transform"
          style={{ backgroundColor: '#ffffff', color: '#DC2626', border: '1px solid #DC2626' }}
        >
          🗑️ মুছে ফেলুন
        </button>
        <button
          type="button"
          onClick={handleJpgShare}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded font-bold text-[15px] text-white active:scale-[0.97] transition-transform"
          style={{ backgroundColor: '#0A4384', border: 'none' }}
        >
          📢 শেয়ার করুন
        </button>
      </div>

      {/* ── Delete confirmation ──────────────────────────────────── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>লেনদেন মুছে ফেলুন?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              এই লেনদেন মুছে গেলে{' '}
              <span className="font-semibold text-slate-800">{party.name}</span>-এর
              ব্যালেন্স আপডেট হয়ে যাবে। এটি পূর্বাবস্থায় ফেরানো যাবে না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-bold">বাতিল</AlertDialogCancel>
            <Button variant="destructive" className="font-bold" onClick={handleDelete}>
              মুছে ফেলুন
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Lightbox ─────────────────────────────────────────────── */}
      {lightboxImage && (
        <BillImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}

      {/* ── Edit overlay ─────────────────────────────────────────── */}
      {isEditOpen && entry && (
        <TransactionEntryScreen
          partyId={partyId}
          partyName={party.name}
          type={entry.type as LedgerEntryType}
          initialEntry={entry}
          onClose={() => setIsEditOpen(false)}
        />
      )}
    </div>
  );
}
