import { useState } from 'react';
import { useLocation } from 'wouter';
import { ChevronLeft, Plus, Phone, Mail, Check, X, Shield, Lock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOwnerWorkers, useCreateWorker, useUpdateWorker, useOwnerParties } from '@/hooks/use-owner';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

export function AccessPage() {
  const [, navigate] = useLocation();
  const { data: workers = [], isLoading: workersLoading } = useOwnerWorkers();
  const { data: parties = [] } = useOwnerParties();
  
  const [isAddWorkerOpen, setIsAddWorkerOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const selectedWorker = workers.find(w => w.id === selectedWorkerId);

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] w-full relative">
      <div className="bg-[#1B3A6B] shadow-sm z-10 shrink-0 sticky top-0">
        <div className="flex items-center gap-3 px-3 pb-4 pt-[calc(0.75rem+var(--safe-top))]">
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="min-w-0 flex-1 text-left">
            <h2 className="text-[17px] font-extrabold text-white leading-tight">স্টাফ ম্যানেজমেন্ট</h2>
            <p className="text-[11px] font-semibold text-white/70 mt-0.5">আপনার ব্যবসার স্টাফ কন্ট্রোল করুন</p>
          </div>
          <button
            onClick={() => setIsAddWorkerOpen(true)}
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {workersLoading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#1B3A6B] animate-spin" />
          </div>
        ) : workers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
              <Shield className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm font-bold text-slate-700">কোনো স্টাফ যুক্ত নেই</p>
            <p className="text-xs font-medium text-slate-500 mt-1">নতুন স্টাফ যুক্ত করে খাতার অ্যাক্সেস দিন</p>
            <Button onClick={() => setIsAddWorkerOpen(true)} className="mt-4 bg-[#1B3A6B] hover:bg-[#142d55]" size="sm">
              স্টাফ যোগ করুন
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {workers.map((worker) => (
              <div 
                key={worker.id} 
                onClick={() => setSelectedWorkerId(worker.id)}
                className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer active:scale-[0.99] transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    {worker.identity.includes('@') ? (
                      <Mail className="w-5 h-5 text-slate-600" />
                    ) : (
                      <Phone className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate text-[15px]">{worker.identity}</p>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">
                      {worker.partyIds.length} টি খাতার অ্যাক্সেস
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    worker.status === 'active' ? "bg-emerald-100 text-emerald-700" :
                    worker.status === 'pending' ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  )}>
                    {worker.status === 'active' ? 'সক্রিয়' : worker.status === 'pending' ? 'পেন্ডিং' : 'সাসপেন্ড'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddWorkerDialog open={isAddWorkerOpen} onOpenChange={setIsAddWorkerOpen} />
      
      {selectedWorker && (
        <WorkerDetailDialog 
          worker={selectedWorker} 
          open={!!selectedWorkerId} 
          onOpenChange={(op) => !op && setSelectedWorkerId(null)} 
          parties={parties}
        />
      )}
    </div>
  );
}

function AddWorkerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (val: boolean) => void }) {
  const [identity, setIdentity] = useState('');
  const createWorker = useCreateWorker();

  const handleAdd = () => {
    if (!identity.trim()) return;
    const isEmail = identity.includes('@');
    if (!isEmail) {
      toast.error('এসএমএস সেটআপ এখনও বাকি। শুধুমাত্র ভেরিফাইড ইমেইল ব্যবহার করুন।');
      return;
    }
    createWorker.mutate({
      email: isEmail ? identity : undefined,
      phone: !isEmail ? identity : undefined,
      partyIds: [],
    }, {
      onSuccess: () => {
        toast.success("স্টাফ যোগ করা হয়েছে");
        onOpenChange(false);
        setIdentity('');
      },
      onError: (err: any) => {
        toast.error(err.message || "স্টাফ যোগ করতে সমস্যা হয়েছে");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden gap-0">
        <DialogHeader className="p-5 pb-4 border-b border-slate-100 bg-slate-50/50">
          <DialogTitle className="text-lg font-extrabold text-slate-900">নতুন স্টাফ যোগ করুন</DialogTitle>
          <p className="text-xs font-medium text-slate-500 mt-1">ইমেইল দিয়ে স্টাফ যুক্ত করুন। (এসএমএস সেটআপ এখনও বাকি)</p>
        </DialogHeader>
        <div className="p-5">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 mb-1.5 block">স্টাফ ইমেইল</label>
              <Input
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="email@example.com"
                className="h-12 bg-slate-50"
              />
            </div>
          </div>
        </div>
        <div className="p-5 pt-0 border-t-0">
          <Button 
            className="w-full h-12 rounded-xl bg-[#1B3A6B] hover:bg-[#142d55] font-bold text-sm"
            onClick={handleAdd}
            disabled={createWorker.isPending || !identity.trim() || !identity.includes('@')}
          >
            {createWorker.isPending ? "যোগ করা হচ্ছে..." : "যুক্ত করুন"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkerDetailDialog({ worker, open, onOpenChange, parties }: { worker: any; open: boolean; onOpenChange: (val: boolean) => void; parties: any[] }) {
  const updateWorker = useUpdateWorker();
  const [search, setSearch] = useState('');
  
  const toggleParty = (partyId: string) => {
    const isSelected = worker.partyIds.includes(partyId);
    const newIds = isSelected 
      ? worker.partyIds.filter((id: string) => id !== partyId)
      : [...worker.partyIds, partyId];
      
    updateWorker.mutate({
      id: worker.id,
      payload: { partyIds: newIds }
    }, {
      onError: (err: any) => toast.error(err.message || "খাতা আপডেট করতে সমস্যা হয়েছে")
    });
  };

  const toggleStatus = () => {
    updateWorker.mutate({
      id: worker.id,
      payload: { status: worker.status === 'active' ? 'suspended' : 'active' }
    }, {
      onError: (err: any) => toast.error(err.message || "স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে")
    });
  };

  const filteredParties = parties.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full h-[85vh] sm:h-[80vh] flex flex-col p-0 gap-0 overflow-hidden rounded-t-3xl sm:rounded-2xl mt-auto sm:mt-0">
        <DialogHeader className="p-4 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                {worker.identity.includes('@') ? <Mail className="w-5 h-5 text-slate-500" /> : <Phone className="w-5 h-5 text-slate-500" />}
              </div>
              <div>
                <DialogTitle className="text-base font-extrabold text-slate-900">{worker.identity}</DialogTitle>
                <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mt-0.5">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    worker.status === 'active' ? "bg-emerald-500" :
                    worker.status === 'pending' ? "bg-amber-500" :
                    "bg-red-500"
                  )} />
                  {worker.status === 'active' ? 'অ্যাক্টিভ' : worker.status === 'pending' ? 'পেন্ডিং' : 'সাসপেন্ডেড'}
                </div>
              </div>
            </div>
            {worker.status !== 'suspended' && (
              <Button 
                variant="outline" 
                size="sm" 
                className={cn("h-8 px-3 rounded-lg text-xs font-bold transition-colors", worker.status === 'active' ? "text-red-600 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50")}
                onClick={toggleStatus}
                disabled={updateWorker.isPending}
              >
                {worker.status === 'active' ? 'সাসপেন্ড করুন' : 'অ্যাক্টিভ করুন'}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="p-4 bg-slate-50 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="খাতা খুঁজুন..." 
              className="pl-9 h-10 bg-white border-slate-200 rounded-xl"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 bg-slate-50">
          {parties.length === 0 ? (
            <div className="text-center p-8 text-slate-500 text-sm font-medium">কোনো খাতা নেই</div>
          ) : filteredParties.length === 0 ? (
            <div className="text-center p-8 text-slate-500 text-sm font-medium">খুঁজে পাওয়া যায়নি</div>
          ) : (
            <div className="space-y-1.5">
              {filteredParties.map((party) => {
                const isAssigned = worker.partyIds.includes(party.id);
                return (
                  <div 
                    key={party.id}
                    onClick={() => toggleParty(party.id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl border bg-white cursor-pointer transition-all active:scale-[0.99]",
                      isAssigned ? "border-[#1B3A6B]/30 ring-1 ring-[#1B3A6B]/10" : "border-slate-200"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm",
                        party.role === 'CUSTOMER' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      )}>
                        {party.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-slate-900">{party.name}</p>
                        <p className="text-[10px] font-semibold text-slate-500">{party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}</p>
                      </div>
                    </div>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center border transition-colors",
                      isAssigned ? "bg-[#1B3A6B] border-[#1B3A6B] text-white" : "border-slate-300 bg-slate-50 text-transparent"
                    )}>
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}