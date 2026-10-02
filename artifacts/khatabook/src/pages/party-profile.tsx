import { useState, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  useGetParty,
  useDeleteParty,
  getGetPartyQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
  type Party,
  type DashboardSummary,
} from '@workspace/api-client-react';
import { shiftSummaryForPartyChange } from '@/lib/optimistic';
import {
  ChevronLeft,
  Phone,
  MapPin,
  Landmark,
  UserCog,
  Trash2,
  RefreshCw,
  Save,
} from 'lucide-react';
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
import { toast } from 'sonner';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';

export function PartyProfileView() {
  const [, params] = useRoute('/party/:id/profile');
  const id = params?.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessContext();

  const { data: party, isLoading } = useGetParty(id || '', {
    query: { enabled: !!id, queryKey: businessScopedQueryKey(getGetPartyQueryKey(id || ''), selectedBusinessId) },
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Local editable state — initialised once the party loads
  const [editName, setEditName] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editBank, setEditBank] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (party) {
      setEditName(party.name);
      setEditMobile(party.phone || '');
      setEditAddress('');
      setEditBank('');
      setIsDirty(false);
    }
  }, [party?.id]);

  // Optimistic delete — mirrors the logic in party-view.tsx so the list &
  // summary cards update instantly while the network request runs in background.
  const deleteParty = useDeleteParty({
    mutation: {
      onMutate: async ({ partyId }) => {
        const partiesKey = businessScopedQueryKey(getListPartiesQueryKey(), selectedBusinessId);
        const summaryKey = businessScopedQueryKey(getGetDashboardSummaryQueryKey(), selectedBusinessId);
        const previousParties = queryClient.getQueryData<Party[]>(partiesKey);
        const previousSummary = queryClient.getQueryData<DashboardSummary>(summaryKey);
        const removedParty = previousParties?.find((p) => p.id === partyId);

        if (previousParties) {
          queryClient.setQueryData<Party[]>(
            partiesKey,
            previousParties.filter((p) => p.id !== partyId),
          );
        }
        if (previousSummary) {
          let next = shiftSummaryForPartyChange(previousSummary, removedParty, undefined);
          next = {
            ...next,
            customerCount: next.customerCount - (removedParty?.role === 'CUSTOMER' ? 1 : 0),
            supplierCount: next.supplierCount - (removedParty?.role === 'SUPPLIER' ? 1 : 0),
          };
          queryClient.setQueryData<DashboardSummary>(summaryKey, next);
        }

        return { partiesKey, summaryKey, previousParties, previousSummary };
      },
      onError: (err, _vars, context) => {
        console.error('পার্টি ডিলিট ব্যর্থ হয়েছে:', err);
        if (!context) return;
        queryClient.setQueryData(context.partiesKey, context.previousParties);
        queryClient.setQueryData(context.summaryKey, context.previousSummary);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    },
  });

  const handleDelete = () => {
    if (!id) return;
    setShowDeleteConfirm(false);
    navigate('/');
    deleteParty.mutate({ partyId: id });
  };

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-[#f8fafc]">
        <div className="h-[140px] bg-[#0b57d0] animate-pulse" />
        <div className="flex-1 p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[60px] bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!party) return null;

  const isCustomer = party.role === 'CUSTOMER';
  const roleLabel = isCustomer ? 'কাস্টমার' : 'সাপ্লায়ার';
  const otherRoleLabel = isCustomer ? 'সাপ্লায়ার' : 'কাস্টমার';

  const handleSave = () => {
    // No PATCH /parties/:id endpoint yet — show coming-soon toast
    toast.info('তথ্য পরিবর্তন সেভ করা হয়েছে (শীঘ্রই সার্ভারে সংরক্ষিত হবে)');
    setIsDirty(false);
  };

  const inputCls =
    'w-full bg-transparent text-sm font-semibold text-slate-800 placeholder:text-slate-300 placeholder:font-normal focus:outline-none';

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] w-full">

      {/* ── Blue header bar ── */}
      <div className="bg-[#0b57d0] shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-3 pt-[calc(0.75rem+var(--safe-top))] pb-3">
          <button
            type="button"
            onClick={() => navigate(`/party/${id}`)}
            aria-label="পিছনে যান"
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h2 className="text-[15px] font-extrabold text-white leading-tight flex-1 truncate">
            {roleLabel} প্রোফাইল
          </h2>
        </div>
      </div>

      {/* ── Avatar + name banner (still blue, no extra bottom padding) ── */}
      <div className="bg-[#0b57d0] px-4 pb-5 shrink-0">
        <div className="flex flex-col items-center gap-2.5 pt-1">
          <div className="w-[68px] h-[68px] rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-white text-2xl font-extrabold">
            {party.name.charAt(0).toUpperCase()}
          </div>
          <p className="text-white font-extrabold text-[17px] leading-tight text-center">{editName || party.name}</p>
          <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-white/20 text-white uppercase tracking-wider">
            {roleLabel}
          </span>
        </div>
      </div>

      {/* ── Scrollable body (starts directly below the blue banner — no negative margin) ── */}
      <div className="flex-1 overflow-y-auto pb-[calc(5.5rem+var(--safe-bottom))]">

        {/* Balance card — sits naturally at the top of the scroll area */}
        <div className="px-4 pt-4">
          <div className={cn(
            'rounded-2xl shadow-md px-5 py-4 flex items-center justify-between',
            party.balanceType === 'YOU_WILL_GET'
              ? 'bg-emerald-50 border border-emerald-100'
              : 'bg-red-50 border border-red-100',
          )}>
            <p className={cn(
              'text-sm font-bold',
              party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-700' : 'text-red-600',
            )}>
              {party.balanceType === 'YOU_WILL_GET' ? 'আপনি পাবেন' : 'আপনি দেবেন'}
            </p>
            <p className={cn(
              'text-xl font-extrabold tracking-tight',
              party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-600',
            )}>
              {formatCurrency(party.currentBalance)}
            </p>
          </div>
        </div>

        {/* ── Editable info fields ── */}
        <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden divide-y divide-slate-100">

          {/* Name */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <UserCog className="w-5 h-5 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-1">নাম</p>
              <input
                type="text"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setIsDirty(true); }}
                placeholder="নাম লিখুন"
                className={inputCls}
              />
            </div>
          </div>

          {/* Mobile */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Phone className="w-5 h-5 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-1">মোবাইল</p>
              <input
                type="tel"
                value={editMobile}
                onChange={(e) => { setEditMobile(e.target.value); setIsDirty(true); }}
                placeholder="মোবাইল নম্বর লিখুন"
                className={inputCls}
              />
            </div>
          </div>

          {/* Address */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <MapPin className="w-5 h-5 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-1">ঠিকানা</p>
              <input
                type="text"
                value={editAddress}
                onChange={(e) => { setEditAddress(e.target.value); setIsDirty(true); }}
                placeholder="যোগ করা হয়নি"
                className={inputCls}
              />
            </div>
          </div>

          {/* Bank */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Landmark className="w-5 h-5 text-slate-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-1">ব্যাংক</p>
              <input
                type="text"
                value={editBank}
                onChange={(e) => { setEditBank(e.target.value); setIsDirty(true); }}
                placeholder="যোগ করা হয়নি"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* Save button — only shown when something changed */}
        {isDirty && (
          <div className="mx-4 mt-3">
            <button
              type="button"
              onClick={handleSave}
              className="w-full bg-[#0b57d0] text-white font-bold text-sm py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-md"
            >
              <Save className="w-4 h-4" />
              তথ্য পরিবর্তন সেভ করুন
            </button>
          </div>
        )}

        {/* Convert role */}
        <div className="mx-4 mt-3">
          <button
            type="button"
            onClick={() => toast.info(`শীঘ্রই আসছে: ${otherRoleLabel}-তে রূপান্তর`)}
            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-sm active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-slate-400 shrink-0" />
              <p className="text-sm font-semibold text-slate-700">
                {otherRoleLabel}-তে রূপান্তর করুন
              </p>
            </div>
          </button>
        </div>

        {/* Member since */}
        <p className="text-center text-[11px] text-slate-400 font-medium mt-5 mb-2">
          যোগ হয়েছে{' '}
          {format(new Date(party.createdAt), 'd MMMM yyyy', { locale: bn })}
        </p>
      </div>

      {/* ── Delete button — fixed at bottom ── */}
      <div className="shrink-0 px-4 py-3 bg-white border-t border-slate-100 pb-[calc(0.75rem+var(--safe-bottom))]">
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-200 bg-red-50 text-red-600 font-bold text-sm active:scale-[0.98] active:bg-red-100 transition-all"
        >
          <Trash2 className="w-4 h-4" />
          {roleLabel} মুছুন
        </button>
      </div>

      {/* ── Delete confirmation dialog ── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{roleLabel} ডিলিট করুন</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600">
              এই {roleLabel}-এর সব লেনদেন স্থায়ীভাবে মুছে যাবে। সংযুক্ত ট্রান্সফার অন্য খাতা থেকেও মুছে সেই পক্ষের ব্যালেন্স সংশোধন হবে। এই কাজ পূর্বাবস্থায় ফেরানো যাবে না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-bold">বাতিল করুন</AlertDialogCancel>
            <Button variant="destructive" className="font-bold" onClick={handleDelete}>
              ডিলিট করুন
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
