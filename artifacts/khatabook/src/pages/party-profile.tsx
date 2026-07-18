import { useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
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
  ChevronRight,
  Phone,
  MapPin,
  Building2,
  Landmark,
  UserCog,
  Trash2,
  RefreshCw,
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

  const { data: party, isLoading } = useGetParty(id || '', {
    query: { enabled: !!id, queryKey: getGetPartyQueryKey(id || '') },
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Optimistic delete — mirrors the logic in party-view.tsx so the list &
  // summary cards update instantly while the network request runs in background.
  const deleteParty = useDeleteParty({
    mutation: {
      onMutate: async ({ partyId }) => {
        const partiesKey = getListPartiesQueryKey();
        const summaryKey = getGetDashboardSummaryQueryKey();
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

  const infoRows: { icon: React.ReactNode; label: string; value: string | null }[] = [
    { icon: <UserCog className="w-5 h-5" />,  label: 'নাম',      value: party.name },
    { icon: <Phone className="w-5 h-5" />,    label: 'মোবাইল',  value: party.phone || null },
    { icon: <MapPin className="w-5 h-5" />,   label: 'ঠিকানা',  value: null },
    { icon: <Building2 className="w-5 h-5" />,label: 'GSTIN',    value: null },
    { icon: <Landmark className="w-5 h-5" />, label: 'ব্যাংক',  value: null },
  ];

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

      {/* ── Avatar + name banner (still blue) ── */}
      <div className="bg-[#0b57d0] px-4 pb-10 shrink-0">
        <div className="flex flex-col items-center gap-2.5 pt-1">
          <div className="w-[68px] h-[68px] rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center text-white text-2xl font-extrabold">
            {party.name.charAt(0).toUpperCase()}
          </div>
          <p className="text-white font-extrabold text-[17px] leading-tight text-center">{party.name}</p>
          <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-white/20 text-white uppercase tracking-wider">
            {roleLabel}
          </span>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto pb-[calc(5.5rem+var(--safe-bottom))]">

        {/* Balance card overlapping the blue header */}
        <div className="px-4 -mt-6">
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

        {/* Info rows */}
        <div className="mx-4 mt-4 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden divide-y divide-slate-100">
          {infoRows.map(({ icon, label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-3.5 active:bg-slate-50 transition-colors cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-slate-400 shrink-0">{icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide leading-none mb-1">
                    {label}
                  </p>
                  <p className={cn(
                    'text-sm font-semibold truncate',
                    value ? 'text-slate-800' : 'text-slate-300 italic',
                  )}>
                    {value ?? 'যোগ করা হয়নি'}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 ml-2" />
            </div>
          ))}
        </div>

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
            <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
          </button>
        </div>

        {/* Member since */}
        <p className="text-center text-[11px] text-slate-400 font-medium mt-5">
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
              আপনি কি নিশ্চিত? এই {roleLabel}-এর সমস্ত হিসাব মুছে যাবে এবং এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না।
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
