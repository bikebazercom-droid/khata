import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import {
  useGetParty,
  useListLedgerEntries,
  useSendPaymentReminder,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  LedgerEntryType,
} from '@workspace/api-client-react';
import { ChevronLeft, Phone, FileText, BellRing, Copy, Check } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddTransactionModal } from '@/components/modals/add-transaction-modal';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { toast } from 'sonner';

export function PartyView() {
  const [, params] = useRoute('/party/:id');
  const id = params?.id;

  const { data: party, isLoading: partyLoading } = useGetParty(id || '', { query: { enabled: !!id, queryKey: getGetPartyQueryKey(id || '') } });
  const { data: entries = [], isLoading: entriesLoading } = useListLedgerEntries(id || '', { query: { enabled: !!id, queryKey: getListLedgerEntriesQueryKey(id || '') } });
  const sendReminder = useSendPaymentReminder();

  const [transactionType, setTransactionType] = useState<LedgerEntryType | null>(null);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReminder = () => {
    if (!id) return;
    sendReminder.mutate(
      { partyId: id },
      {
        onSuccess: (res) => {
          setCopied(false);
          setReminderMessage(res.message);
        },
      }
    );
  };

  const handleCopy = async () => {
    if (!reminderMessage) return;
    try {
      await navigator.clipboard.writeText(reminderMessage);
      setCopied(true);
      toast.success('বার্তা কপি করা হয়েছে');
      setTimeout(() => setCopied(false), 2000);
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

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] w-full">
      {/* Sticky top action bar */}
      <div className="bg-white border-b border-slate-200 shadow-sm z-10 shrink-0 sticky top-0">
        <div className="flex items-center gap-3 px-3 py-3">
          <Link
            href="/"
            aria-label="পিছনে যান"
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div
            className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center text-lg font-extrabold shrink-0 border-2',
              party.balanceType === 'YOU_WILL_GET'
                ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                : 'bg-red-50 text-red-600 border-red-100'
            )}
          >
            {party.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-extrabold text-slate-900 leading-tight truncate">{party.name}</h2>
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
              <Phone className="w-3 h-3" /> {party.phone}
            </span>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              {party.balanceType === 'YOU_WILL_GET' ? 'পাবেন' : 'দেবেন'}
            </p>
            <p
              className={cn(
                'text-lg font-extrabold tracking-tight',
                party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-500'
              )}
            >
              {formatCurrency(party.currentBalance)}
            </p>
          </div>
        </div>
        <div className="px-3 pb-3">
          <Button
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm active:scale-[0.98] transition-transform"
            onClick={handleReminder}
          >
            <BellRing className="w-4 h-4 mr-2" /> তাগাদা পাঠান (SMS)
          </Button>
        </div>
      </div>

      {/* Scrollable ledger area */}
      <div className="flex-1 overflow-y-auto p-3 pb-4">
        {entriesLoading ? (
          <div className="flex justify-center p-12">
            <div className="animate-pulse w-8 h-8 rounded-full bg-slate-200"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-xs mx-auto py-16">
            <div className="w-20 h-20 bg-white border-4 border-slate-100 shadow-sm rounded-full flex items-center justify-center mb-5 text-slate-300">
              <FileText className="w-9 h-9" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 mb-2 tracking-tight">এখনো কোনো লেনদেন নেই</h3>
            <p className="text-slate-500 font-medium text-sm">{party.name}-এর সাথে হিসাব রাখা শুরু করতে একটি লেনদেন যুক্ত করুন।</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, i) => {
              const isGave = entry.type === 'YOU_GAVE';
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 border-l-4 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both',
                    isGave ? 'border-l-red-400' : 'border-l-emerald-400'
                  )}
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-[11px] font-bold text-slate-400">
                        {format(new Date(entry.createdAt), 'dd MMM yyyy, hh:mm a', { locale: bn })}
                      </p>
                      {entry.billReference && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                          বিল: {entry.billReference}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-700 truncate">
                      {isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন'}
                      {entry.description ? ` · ${entry.description}` : ''}
                    </p>
                  </div>
                  <p className={cn('text-lg font-extrabold shrink-0', isGave ? 'text-red-600' : 'text-emerald-600')}>
                    {formatCurrency(entry.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky bottom action overlay */}
      <div className="bg-white border-t border-slate-200 p-3 flex gap-3 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] shrink-0 z-20">
        <Button
          variant="destructive"
          className="flex-1 h-16 text-base font-extrabold shadow-[0_4px_14px_0_rgba(239,68,68,0.35)] active:scale-[0.98] transition-all rounded-2xl"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GAVE)}
        >
          আপনি দিয়েছেন (৳)
        </Button>
        <Button
          variant="success"
          className="flex-1 h-16 text-base font-extrabold shadow-[0_4px_14px_0_rgba(16,185,129,0.35)] active:scale-[0.98] transition-all rounded-2xl"
          onClick={() => setTransactionType(LedgerEntryType.YOU_GOT)}
        >
          আপনি পেয়েছেন (৳)
        </Button>
      </div>

      <AddTransactionModal
        partyId={id}
        type={transactionType}
        open={!!transactionType}
        onOpenChange={(open) => !open && setTransactionType(null)}
      />

      <Dialog open={!!reminderMessage} onOpenChange={(open) => !open && setReminderMessage(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-emerald-600" /> তাগাদা পাঠানো হয়েছে
            </DialogTitle>
          </DialogHeader>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-medium text-slate-700 leading-relaxed">
            {reminderMessage}
          </div>
          <Button onClick={handleCopy} variant="outline" className="w-full font-bold">
            {copied ? <Check className="w-4 h-4 mr-2 text-emerald-600" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied ? 'কপি হয়েছে' : 'বার্তা কপি করুন'}
          </Button>
          <p className="text-xs text-slate-400 font-medium text-center">এটি একটি সিমুলেটেড SMS বার্তা — কোনো বাস্তব SMS পাঠানো হয়নি।</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
