import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react';
import { useListParties, getListPartiesQueryKey } from '@workspace/api-client-react';
import { toast } from 'sonner';
import { useAppAuth } from '@/App';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import { readOfflineIdentity } from '@/lib/authCache';
import {
  discardRejectedEntry,
  ENTRY_OUTBOX_CHANGED,
  listRejectedEntries,
  type QueuedEntry,
} from '@/lib/entryOutbox';

type DraftSnapshot = {
  scope: string;
  entries: QueuedEntry[];
};

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'তারিখ জানা নেই'
    : date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short', hour12: true });
}

export function RejectedDraftsPage() {
  const { userId } = useAppAuth();
  const { selectedBusinessId } = useBusinessContext();
  const [, navigate] = useLocation();
  const partiesParams = {};
  const { data: parties = [] } = useListParties(partiesParams, {
    query: { queryKey: businessScopedQueryKey(getListPartiesQueryKey(partiesParams), selectedBusinessId) },
  });
  const partyNames = useMemo(() => new Map(parties.map((party) => [party.id, party.name])), [parties]);
  const scope = userId && selectedBusinessId
    ? JSON.stringify([userId, selectedBusinessId])
    : '';
  const [snapshot, setSnapshot] = useState<DraftSnapshot>({ scope: '', entries: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const entries = snapshot.scope === scope ? snapshot.entries : [];

  useEffect(() => {
    if (!userId || !selectedBusinessId) {
      setSnapshot({ scope: '', entries: [] });
      setLoading(false);
      return;
    }

    let active = true;
    const activeScope = JSON.stringify([userId, selectedBusinessId]);
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const identity = readOfflineIdentity();
        const includeLegacyUnscoped = identity?.userId === userId &&
          identity.businessId === selectedBusinessId;
        const rejected = await listRejectedEntries(userId, selectedBusinessId, includeLegacyUnscoped);
        if (active) setSnapshot({ scope: activeScope, entries: rejected });
      } catch {
        if (active) setLoadError('সংরক্ষিত খসড়া পড়া যাচ্ছে না। ব্রাউজারের স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    window.addEventListener(ENTRY_OUTBOX_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(ENTRY_OUTBOX_CHANGED, load);
    };
  }, [userId, selectedBusinessId, reloadKey]);

  const discard = async (entry: QueuedEntry) => {
    if (!userId || !selectedBusinessId) return;
    const partyName = partyNames.get(entry.partyId) ?? 'এই খসড়ার হিসাব';
    const amount = Number(entry.data.amount).toLocaleString('bn-BD');
    const confirmed = window.confirm(
      `${partyName} · ৳${amount} খসড়াটি ব্রাউজার থেকে মুছে ফেলবেন? এটি ফিরিয়ে আনা যাবে না।`,
    );
    if (!confirmed) return;

    setDiscardingId(entry.id);
    try {
      const identity = readOfflineIdentity();
      const includeLegacyUnscoped = identity?.userId === userId &&
        identity.businessId === selectedBusinessId;
      const removed = await discardRejectedEntry(
        entry.id,
        userId,
        selectedBusinessId,
        includeLegacyUnscoped,
      );
      if (!removed) {
        toast.error('খসড়াটি আর পাওয়া যাচ্ছে না। তালিকাটি আবার হালনাগাদ করুন।');
        setReloadKey((key) => key + 1);
        return;
      }
      setSnapshot((current) => current.scope === scope
        ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id) }
        : current);
      toast.success('খসড়াটি ব্রাউজার থেকে মুছে ফেলা হয়েছে।');
    } catch {
      toast.error('খসড়াটি মুছতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    } finally {
      setDiscardingId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <header className="shrink-0 bg-[#1B3A6B] px-4 pb-5 pt-[calc(1rem+var(--safe-top))] text-white">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="হিসাবের পাতায় ফিরুন"
            onClick={() => navigate('/')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 active:bg-white/25"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-extrabold">প্রত্যাখ্যাত খসড়া</h1>
            <p className="mt-0.5 text-xs text-blue-100">সার্ভারের কারণসহ পুরোনো ব্রাউজার খসড়া</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-xs leading-5 text-blue-900">
          এখানে শুধু সার্ভারে প্রত্যাখ্যাত খসড়া দেখানো হয়। অপেক্ষমাণ খসড়াগুলো আগের নিয়মে সিঙ্ক হবে; সেগুলো এই তালিকা থেকে মুছে ফেলা হয় না।
        </p>

        {loading && (
          <p role="status" className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm">
            খসড়া খোঁজা হচ্ছে…
          </p>
        )}

        {loadError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 font-bold text-red-800"
            >
              <RefreshCw className="h-4 w-4" />
              আবার চেষ্টা করুন
            </button>
          </div>
        )}

        {!loading && !loadError && entries.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <h2 className="font-bold text-slate-900">কোনো প্রত্যাখ্যাত খসড়া নেই</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              এই ব্যবসার জন্য পর্যালোচনার অপেক্ষায় থাকা কোনো পুরোনো খসড়া পাওয়া যায়নি।
            </p>
          </div>
        )}

        <div className="space-y-3">
          {entries.map((entry) => {
            const partyName = partyNames.get(entry.partyId) ?? 'হিসাবটি আর উপলভ্য নেই';
            const amount = Number(entry.data.amount).toLocaleString('bn-BD');
            const direction = entry.data.type === 'YOU_GAVE'
              ? 'আপনি দিয়েছেন'
              : entry.data.type === 'YOU_GOT'
                ? 'আপনি পেয়েছেন'
                : 'লেনদেন';

            return (
              <article key={entry.id} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold text-slate-900">{partyName}</h2>
                    <p className="mt-1 text-xs text-slate-500">{formatCreatedAt(entry.createdAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-extrabold text-slate-900">৳{amount}</p>
                    <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{direction}</p>
                  </div>
                </div>

                {entry.data.description && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">
                    {entry.data.description}
                  </p>
                )}

                {entry.data.isTransfer && entry.data.transferPartyId && (
                  <p className="mt-2 text-sm text-slate-700">
                    স্থানান্তরের হিসাব: {partyNames.get(entry.data.transferPartyId) ?? 'অন্য একটি হিসাব'}
                  </p>
                )}

                <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                  <p className="text-[11px] font-bold text-red-800">প্রত্যাখ্যানের কারণ</p>
                  <p className="mt-1 break-words text-sm leading-5 text-red-900">
                    {entry.error || 'এই পুরোনো খসড়ার জন্য কারণ সংরক্ষিত ছিল না।'}
                  </p>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void discard(entry)}
                    disabled={discardingId === entry.id}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {discardingId === entry.id ? 'মুছছে…' : 'খসড়া মুছুন'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}