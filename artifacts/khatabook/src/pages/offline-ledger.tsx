import { useEffect, useState } from 'react';
import type { OfflineIdentity } from '@/lib/authCache';
import { getOfflineEntries } from '@/lib/queryPersister';
import { listEntries, type QueuedEntry } from '@/lib/entryOutbox';
import type { LedgerEntry } from '@workspace/api-client-react';

type Party = { id: string; name: string; currentBalance?: number; balanceType?: string; role?: string };
type Entry = LedgerEntry;

// Deliberately separate from Clerk and the online mutation components. This view
// cannot issue network writes or initiate bill uploads while identity is unverified.
export function OfflineLedger({ identity, businessId }: { identity: OfflineIdentity | null; businessId: string | null }) {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<QueuedEntry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setDrafts([]);
    if (!identity || !businessId) return;
    let active = true;
    Promise.all([listEntries(identity.userId, businessId), ...(businessId === identity.businessId ? [listEntries(identity.userId, null)] : [])]).then((groups) => {
      if (active) setDrafts(groups.flat());
    }).catch(() => { if (active) setError('অফলাইন খসড়া পড়া যাচ্ছে না। ব্রাউজারের স্টোরেজ পরীক্ষা করুন।'); });
    return () => { active = false; };
  }, [identity, businessId]);

  if (!identity || !businessId || !identity.permittedBusinessIds.includes(businessId)) {
    return <div className="min-h-screen bg-slate-50 p-8 text-center text-slate-700">
      <h1 className="text-xl font-bold">অফলাইনে হিসাব উপলব্ধ নেই</h1>
      <p className="mt-3">এই ব্রাউজারে আগে অনলাইনে লগইন করে এই ব্যবসার হিসাব খুলুন। তারপর আবার অফলাইনে দেখুন।</p>
    </div>;
  }

  const cached = getOfflineEntries(identity.userId, identity.role, businessId);
  const parties = new Map<string, Party>();
  let entries: Entry[] = [];
  for (const [raw, value] of Object.entries(cached)) {
    const key = JSON.parse(raw) as [string, ...unknown[]];
    if (key[0] === '/api/parties' && Array.isArray(value)) {
      for (const p of value as Party[]) if (p && typeof p.id === 'string') parties.set(p.id, p);
    }
    if (partyId && key[0] === `/api/parties/${partyId}` && value && !Array.isArray(value)) {
      const party = value as Party;
      if (party.id === partyId) parties.set(party.id, party);
    }
    if (partyId && key[0] === `/api/parties/${partyId}/ledger-entries` && Array.isArray(value)) entries = value as Entry[];
  }
  const activeParty = partyId ? parties.get(partyId) : null;
  return <div className="min-h-screen bg-slate-100 text-slate-900">
    <div className="mx-auto max-w-lg min-h-screen bg-white shadow-sm">
      <header className="bg-[#1B3A6B] p-5 text-white">
        <div className="flex justify-between gap-4"><strong>Banglakhata</strong><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">অফলাইন · শুধু দেখা যাবে</span></div>
        <p className="mt-2 text-sm text-blue-100">সর্বশেষ সংরক্ষিত হিসাব। সংযোগ ফিরলে পরিচয় ও অনুমতি আবার যাচাই হবে।</p>
      </header>
      <main className="p-5">
        {partyId && <button className="mb-4 text-blue-700 font-semibold" onClick={() => setPartyId(null)}>← সব হিসাব</button>}
        {partyId ? <>
          <h1 className="text-xl font-bold">{activeParty?.name ?? 'হিসাব'}</h1>
          {activeParty?.currentBalance != null && <p className="my-2">ব্যালেন্স: ৳{activeParty.currentBalance.toLocaleString('bn-BD')}</p>}
          <h2 className="mt-5 font-semibold">সংরক্ষিত লেনদেন</h2>
          {entries.length ? entries.map((entry) => <div key={entry.id} className="border-b py-3">
             <div className="flex justify-between"><span>{entry.type === 'YOU_GAVE' ? 'আপনি দিয়েছেন' : entry.type === 'YOU_GOT' ? 'আপনি পেয়েছেন' : 'লেনদেন'}</span><strong>৳{Number(entry.amount ?? 0).toLocaleString('bn-BD')}</strong></div>
             <p className="text-sm text-slate-500">{entry.description} {entry.createdAt}</p>
          </div>) : <p className="py-4 text-slate-500">এই হিসাবের কোনো সংরক্ষিত লেনদেন নেই।</p>}
        </> : <>
          <h1 className="text-xl font-bold">সংরক্ষিত হিসাব</h1>
          {parties.size ? [...parties.values()].map((party) => <button key={party.id} onClick={() => setPartyId(party.id)} className="w-full border-b py-4 text-left flex justify-between gap-3">
            <span className="font-semibold">{party.name}</span><span>৳{Number(party.currentBalance ?? 0).toLocaleString('bn-BD')} ›</span>
          </button>) : <p className="py-4 text-slate-500">এই ব্যবসার কোনো হিসাব আগে অনলাইনে খোলা হয়নি।</p>}
        </>}
        <h2 className="mt-8 font-semibold">এই ব্যবসার অফলাইন খসড়া ({partyId ? drafts.filter((d) => d.partyId === partyId).length : drafts.length})</h2>
        {(partyId ? drafts.filter((d) => d.partyId === partyId) : drafts).map((draft) => <div key={draft.id} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          {parties.get(draft.partyId)?.name ?? 'হিসাব'} · ৳{Number(draft.data.amount).toLocaleString('bn-BD')} · {draft.status === 'rejected' ? 'পুনরায় যাচাই প্রয়োজন' : 'পাঠানো বাকি'}
        </div>)}
        {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
      </main>
    </div>
  </div>;
}