import { useState } from 'react';
import { useRoute } from 'wouter';
import { 
  useGetParty, 
  useListLedgerEntries, 
  useSendPaymentReminder,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  LedgerEntryType
} from '@workspace/api-client-react';
import { Phone, FileText, BellRing, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddTransactionModal } from '@/components/modals/add-transaction-modal';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';

export function PartyView() {
  const [, params] = useRoute('/party/:id');
  const id = params?.id;

  const { data: party, isLoading: partyLoading } = useGetParty(id || '', { query: { enabled: !!id, queryKey: getGetPartyQueryKey(id || '') } });
  const { data: entries = [], isLoading: entriesLoading } = useListLedgerEntries(id || '', { query: { enabled: !!id, queryKey: getListLedgerEntriesQueryKey(id || '') } });
  const sendReminder = useSendPaymentReminder();

  const [transactionType, setTransactionType] = useState<LedgerEntryType | null>(null);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);

  const handleReminder = () => {
    if (!id) return;
    sendReminder.mutate({ partyId: id }, {
      onSuccess: (res) => {
        setReminderMessage(res.message);
      }
    });
  };

  if (!id) return null;
  
  if (partyLoading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-slate-50">
        <div className="h-32 bg-white border-b border-slate-200 animate-pulse"></div>
        <div className="flex-1 p-6">
          <div className="h-20 bg-slate-200/50 rounded-xl mb-4 animate-pulse"></div>
          <div className="h-20 bg-slate-200/50 rounded-xl mb-4 animate-pulse"></div>
          <div className="h-20 bg-slate-200/50 rounded-xl mb-4 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (!party) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 font-medium">পার্টি খুঁজে পাওয়া যায়নি</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] w-full">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6 shadow-sm z-10 flex flex-col gap-6 shrink-0 relative">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-5">
            <div className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center text-3xl font-extrabold shadow-sm border-2",
              party.balanceType === "YOU_WILL_GET" ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-600 border-red-100"
            )}>
              {party.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 leading-tight mb-1">{party.name}</h2>
              <div className="flex items-center gap-3 text-sm font-semibold text-slate-500">
                <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {party.phone}</span>
                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-xs text-slate-600 uppercase tracking-widest border border-slate-200">
                  {party.role === "CUSTOMER" ? "কাস্টমার" : "সাপ্লায়ার"}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
             <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1">
               {party.balanceType === "YOU_WILL_GET" ? "পাবেন" : "দেবেন"}
             </p>
             <p className={cn(
               "text-4xl font-extrabold tracking-tight",
               party.balanceType === "YOU_WILL_GET" ? "text-emerald-600" : "text-red-500"
             )}>
               {formatCurrency(party.currentBalance)}
             </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" size="sm" className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm h-10 font-bold px-4 rounded-xl transition-colors" onClick={handleReminder}>
            <BellRing className="w-4 h-4 mr-2" /> তাগাদা পাঠান (SMS)
          </Button>
          <Button variant="outline" size="sm" className="bg-white hover:bg-slate-50 text-slate-700 shadow-sm h-10 font-bold px-4 rounded-xl border-slate-200 ml-auto">
            <FileText className="w-4 h-4 mr-2" /> স্টেটমেন্ট রিপোর্ট
          </Button>
        </div>
      </div>

      {/* Ledger History */}
      <div className="flex-1 overflow-y-auto p-8 relative">
        {entriesLoading ? (
           <div className="flex justify-center p-12"><div className="animate-pulse w-8 h-8 rounded-full bg-slate-200"></div></div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto">
            <div className="w-24 h-24 bg-white border-4 border-slate-100 shadow-sm rounded-full flex items-center justify-center mb-6 text-slate-300">
              <FileText className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-extrabold text-slate-900 mb-2 tracking-tight">এখনো কোনো লেনদেন নেই</h3>
            <p className="text-slate-500 font-medium text-base">{party.name}-এর সাথে হিসাব রাখা শুরু করতে একটি লেনদেন যুক্ত করুন।</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex justify-between items-center text-[11px] font-bold text-slate-400 uppercase tracking-widest px-6 mb-4 sticky top-0 bg-[#f8fafc]/90 backdrop-blur-sm py-2 z-10">
              <span>বিস্তারিত হিসাব</span>
              <div className="flex gap-20 mr-6">
                 <span className="w-28 text-right">আপনি দিয়েছেন</span>
                 <span className="w-28 text-right">আপনি পেয়েছেন</span>
              </div>
            </div>
            
            {entries.map((entry, i) => (
              <div 
                key={entry.id} 
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between group hover:border-slate-300 hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1.5">
                    <p className="text-[15px] font-bold text-slate-900">
                      {format(new Date(entry.createdAt), "dd MMM yyyy, hh:mm a", { locale: bn })}
                    </p>
                    {entry.billReference && (
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                        বিল: {entry.billReference}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-500">{entry.description || '—'}</p>
                </div>

                <div className="flex gap-20 mr-4 font-extrabold text-lg">
                  <div className={cn("w-28 text-right", entry.type === "YOU_GAVE" ? "text-red-600 bg-red-50/50 py-1.5 px-4 rounded-xl border border-red-100" : "text-transparent")}>
                    {entry.type === "YOU_GAVE" ? formatCurrency(entry.amount) : "-"}
                  </div>
                  <div className={cn("w-28 text-right", entry.type === "YOU_GOT" ? "text-emerald-600 bg-emerald-50/50 py-1.5 px-4 rounded-xl border border-emerald-100" : "text-transparent")}>
                    {entry.type === "YOU_GOT" ? formatCurrency(entry.amount) : "-"}
                  </div>
                </div>
              </div>
            ))}
            <div className="h-8"></div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="bg-white border-t border-slate-200 p-6 flex gap-6 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.05)] shrink-0 z-20">
        <Button 
          variant="destructive" 
          className="flex-1 h-16 text-lg font-extrabold shadow-[0_4px_14px_0_rgba(239,68,68,0.39)] hover:shadow-[0_6px_20px_rgba(239,68,68,0.23)] hover:bg-red-600 transition-all rounded-2xl"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GAVE)}
        >
          <ArrowUpRight className="w-6 h-6 mr-2" /> আপনি দিয়েছেন (৳ মাল/নগদ)
        </Button>
        <Button 
          variant="success" 
          className="flex-1 h-16 text-lg font-extrabold shadow-[0_4px_14px_0_rgba(16,185,129,0.39)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.23)] hover:bg-emerald-600 transition-all rounded-2xl"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GOT)}
        >
          <ArrowDownLeft className="w-6 h-6 mr-2" /> আপনি পেয়েছেন (৳ ক্যাশ/অনলাইন)
        </Button>
      </div>

      <AddTransactionModal
        partyId={id}
        type={transactionType}
        open={!!transactionType}
        onOpenChange={(open) => !open && setTransactionType(null)}
      />

      <Dialog open={!!reminderMessage} onOpenChange={(open) => !open && setReminderMessage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-emerald-600" /> তাগাদা পাঠানো হয়েছে
            </DialogTitle>
          </DialogHeader>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 leading-relaxed">
            {reminderMessage}
          </div>
          <p className="text-xs text-slate-400 font-medium">এটি একটি সিমুলেটেড SMS বার্তা — কোনো বাস্তব SMS পাঠানো হয়নি।</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
