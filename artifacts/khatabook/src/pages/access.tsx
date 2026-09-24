import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { ChevronLeft, Plus, Phone, Mail, Check, Shield, Search, User, FileText, Activity, Users, MoreVertical, X, History, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOwnerWorkers, useCreateWorker, useUpdateWorker, useOwnerParties, useOwnerActivity, type Worker } from '@/hooks/use-owner';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { bn as bnLocale } from 'date-fns/locale';

type TabType = 'parties' | 'staff' | 'activity';

export function AccessPage() {
  const [, navigate] = useLocation();
  const { data: workers = [], isLoading: workersLoading, isError: workersError } = useOwnerWorkers();
  const { data: parties = [], isLoading: partiesLoading, isError: partiesError } = useOwnerParties();
  const { data: activityData, isLoading: activityLoading, isError: activityError } = useOwnerActivity();

  const [activeTab, setActiveTab] = useState<TabType>('parties');
  const [search, setSearch] = useState('');

  // States for Modals
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [isAddWorkerOpen, setIsAddWorkerOpen] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const selectedWorker = workers.find(w => w.id === selectedWorkerId);
  const selectedParty = parties.find(p => p.id === selectedPartyId);

  const filteredParties = useMemo(() => {
    return parties.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [parties, search]);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#f8fafc] w-full relative">
      <div className="bg-[#1B3A6B] shadow-sm z-10 shrink-0 sticky top-0">
        <div className="flex items-center gap-3 px-3 pb-4 pt-[calc(0.75rem+var(--safe-top))]">
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="min-w-0 flex-1 text-left">
            <h2 className="text-[17px] font-extrabold text-white leading-tight">খাতা ও অ্যাক্সেস</h2>
            <p className="text-[11px] font-semibold text-white/70 mt-0.5">আপনার খাতার কন্ট্রোল ও অ্যাক্টিভিটি</p>
          </div>
          {activeTab === 'staff' && (
            <button
              onClick={() => setIsAddWorkerOpen(true)}
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="px-4">
          <div className="flex items-stretch gap-6 border-b border-white/15">
            <button
              onClick={() => setActiveTab('parties')}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                activeTab === 'parties' ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              খাতা অ্যাক্সেস
            </button>
            <button
              onClick={() => setActiveTab('staff')}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                activeTab === 'staff' ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              স্টাফ তালিকা
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                activeTab === 'activity' ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              অ্যাক্টিভিটি
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'parties' && (
          <div className="p-4 flex flex-col h-full">
            <div className="relative mb-4 shrink-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="কাস্টমার/সাপ্লায়ার খুঁজুন..."
                className="pl-9 h-11 bg-white border-slate-200 rounded-xl"
              />
            </div>

            {partiesLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#1B3A6B] animate-spin" />
              </div>
            ) : partiesError ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-red-500">
                <AlertCircle className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-sm font-medium">খাতার তথ্য লোড করতে সমস্যা হয়েছে</p>
              </div>
            ) : filteredParties.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400">
                <FileText className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">কোনো কাস্টমার/সাপ্লায়ার পাওয়া যায়নি</p>
              </div>
            ) : (
              <div className="space-y-3 pb-6">
                {filteredParties.map((party) => {
                  const assignedWorkers = workers.filter(w => w.partyIds.includes(party.id));
                  return (
                    <div
                      key={party.id}
                      onClick={() => setSelectedPartyId(party.id)}
                      className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm",
                            party.role === 'CUSTOMER' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          )}>
                            {party.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-[15px]">{party.name}</p>
                            <p className="text-[10px] font-semibold text-slate-500 mt-0.5">
                              {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'} • {party.id.slice(-4)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-bold text-slate-700">{assignedWorkers.length}</span>
                        </div>
                      </div>

                      {assignedWorkers.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-2 pt-3 border-t border-slate-100">
                          {assignedWorkers.map(w => (
                            <span key={w.id} className={cn(
                              "text-[10px] font-semibold px-2 py-1 rounded-md border flex items-center gap-1",
                              w.status === 'active' ? "bg-emerald-50/50 border-emerald-200 text-emerald-700" :
                              w.status === 'pending' ? "bg-amber-50/50 border-amber-200 text-amber-700" :
                              "bg-red-50/50 border-red-200 text-red-700"
                            )}>
                              <div className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                w.status === 'active' ? "bg-emerald-500" :
                                w.status === 'pending' ? "bg-amber-500" : "bg-red-500"
                              )} />
                              {w.identity}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 pt-3 border-t border-slate-100 flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-400">কাউকে অ্যাক্সেস দেওয়া নেই</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'staff' && (
          <div className="p-4 pb-10">
            {workersLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#1B3A6B] animate-spin" />
              </div>
            ) : workersError ? (
              <div className="flex flex-col items-center justify-center h-48 text-center bg-white rounded-2xl border border-red-100 p-6 shadow-sm">
                <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-red-700">স্টাফ তালিকা লোড করতে সমস্যা হয়েছে</p>
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
                    className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 cursor-pointer active:scale-[0.99] transition-all flex flex-col"
                  >
                    <div className="flex items-center justify-between mb-3">
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
                    {/* Extra info for staff */}
                    <div className="flex flex-col gap-1 mt-1 pt-3 border-t border-slate-100 text-[11px] text-slate-500 font-medium">
                      {worker.lastLogin && (
                        <p>সর্বশেষ লগইন: {new Date(worker.lastLogin).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      )}
                      {worker.lastLogout && (
                        <p>সর্বশেষ লগআউট: {new Date(worker.lastLogout).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      )}
                      {worker.invitedAt && worker.status === 'pending' && (
                        <p>আমন্ত্রণ: {new Date(worker.invitedAt).toLocaleString('bn-BD', { dateStyle: 'medium' })}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="p-4 pb-10">
            {activityLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#1B3A6B] animate-spin" />
              </div>
            ) : activityError ? (
              <div className="flex flex-col items-center justify-center h-48 text-center bg-white rounded-2xl border border-red-100 p-6 shadow-sm">
                <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-3">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-red-700">অ্যাক্টিভিটি লোড করতে সমস্যা হয়েছে</p>
              </div>
            ) : !activityData?.entries || activityData.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                  <History className="w-6 h-6 text-slate-400" />
                </div>
                <p className="text-sm font-bold text-slate-700">কোনো অ্যাক্টিভিটি নেই</p>
              </div>
            ) : (
              <div className="relative pl-4">
                <div className="absolute left-4 top-2 bottom-0 w-0.5 bg-slate-200" />
                <div className="space-y-5 relative">
                  {activityData.entries.map((entry) => (
                    <div key={entry.id} className="flex gap-4">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#1B3A6B] mt-1.5 shrink-0 z-10 -ml-[5px] ring-4 ring-[#f8fafc]" />
                      <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 p-3.5">
                        <div className="flex justify-between items-start mb-1">
                          <p className="text-sm font-bold text-slate-900">
                            {entry.description || "অ্যাক্টিভিটি"}
                          </p>
                          <span className="text-[10px] font-medium text-slate-400 shrink-0 ml-2 whitespace-nowrap">
                            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true, locale: bnLocale })}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 mt-2">
                          <p className="text-xs text-slate-600 font-medium">
                            খাতা: <span className="font-bold text-slate-800">{entry.partyName}</span>
                          </p>
                          <p className="text-xs text-slate-600 font-medium">
                            ব্যবহারকারী: <span className="font-bold text-slate-800">{entry.actorIdentity}</span>
                          </p>
                          {entry.amount != null && (
                            <p className="text-xs text-slate-600 font-medium">
                              অ্যামাউন্ট: <span className="font-bold text-slate-800">৳{entry.amount}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

      {selectedParty && (
        <PartyAccessDialog
          party={selectedParty}
          workers={workers}
          open={!!selectedPartyId}
          onOpenChange={(op) => !op && setSelectedPartyId(null)}
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
        toast.success("স্টাফ যোগ করা হয়েছে। নির্দেশিকা নিজে শেয়ার করুন, কোনো ইমেইল পাঠানো হয়নি।");
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
            <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-100 flex flex-col gap-2">
              <p className="text-[11.5px] leading-relaxed text-blue-900 font-bold">
                স্বয়ংক্রিয় কোনো ইমেইল পাঠানো হয় না। আপনাকে নিজে অ্যাপের লিংক ও নির্দেশিকা স্টাফের সাথে শেয়ার করতে হবে।
              </p>
              <p className="text-[11px] leading-relaxed text-blue-800 font-medium">
                লক্ষ্য রাখবেন, স্টাফকে ঠিক এই ইমেইলটি ব্যবহার করেই অ্যাপে সাইন-ইন বা নতুন অ্যাকাউন্ট খুলতে হবে। অন্য ইমেইল ব্যবহার করলে তারা অ্যাক্সেস পাবেন না।
              </p>
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

function WorkerDetailDialog({ worker, open, onOpenChange, parties }: { worker: Worker; open: boolean; onOpenChange: (val: boolean) => void; parties: any[] }) {
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
      payload: { status: worker.status === 'active' ? 'suspended' : (worker.status === 'pending' ? 'suspended' : 'active') }
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
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 px-3 rounded-lg text-xs font-bold transition-colors",
                worker.status === 'active' || worker.status === 'pending' ? "text-red-600 hover:bg-red-50 border-red-200" : "text-emerald-600 hover:bg-emerald-50 border-emerald-200"
              )}
              onClick={toggleStatus}
              disabled={updateWorker.isPending}
            >
              {worker.status === 'active' ? 'সাসপেন্ড করুন' : worker.status === 'pending' ? 'আমন্ত্রণ বাতিল করুন' : 'অ্যাক্টিভ করুন'}
            </Button>
          </div>
        </DialogHeader>

        <div className="p-4 bg-slate-50 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="কাস্টমার/সাপ্লায়ার খুঁজুন..."
              className="pl-9 h-10 bg-white border-slate-200 rounded-xl"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 bg-slate-50">
          {parties.length === 0 ? (
            <div className="text-center p-8 text-slate-500 text-sm font-medium">কোনো কাস্টমার/সাপ্লায়ার নেই</div>
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

function PartyAccessDialog({ party, workers, open, onOpenChange }: { party: any; workers: Worker[]; open: boolean; onOpenChange: (val: boolean) => void }) {
  const [identity, setIdentity] = useState('');
  const createWorker = useCreateWorker();
  const updateWorker = useUpdateWorker();

  const assignedWorkers = workers.filter(w => w.partyIds.includes(party.id));

  const handleInvite = () => {
    if (!identity.trim()) return;
    const isEmail = identity.includes('@');
    if (!isEmail) {
      toast.error('এসএমএস সেটআপ এখনও বাকি। শুধুমাত্র ভেরিফাইড ইমেইল ব্যবহার করুন।');
      return;
    }
    createWorker.mutate({
      email: isEmail ? identity : undefined,
      phone: !isEmail ? identity : undefined,
      partyIds: [party.id], // Assign directly to this party
    }, {
      onSuccess: () => {
        toast.success("স্টাফ যোগ করা হয়েছে। নির্দেশিকা নিজে শেয়ার করুন, কোনো ইমেইল পাঠানো হয়নি।");
        setIdentity('');
      },
      onError: (err: any) => {
        toast.error(err.message || "স্টাফ যোগ করতে সমস্যা হয়েছে");
      }
    });
  };

  const handleRevoke = (workerId: string, currentPartyIds: string[]) => {
    const newIds = currentPartyIds.filter(id => id !== party.id);
    updateWorker.mutate({
      id: workerId,
      payload: { partyIds: newIds }
    }, {
      onError: (err: any) => toast.error(err.message || "অ্যাক্সেস সরাতে সমস্যা হয়েছে")
    });
  };

  const handleRestore = (workerId: string, currentPartyIds: string[]) => {
    const newIds = [...currentPartyIds, party.id];
    updateWorker.mutate({
      id: workerId,
      payload: { partyIds: newIds }
    }, {
      onError: (err: any) => toast.error(err.message || "অ্যাক্সেস দিতে সমস্যা হয়েছে")
    });
  };

  const handleToggleStatus = (worker: Worker) => {
    updateWorker.mutate({
      id: worker.id,
      payload: { status: worker.status === 'active' ? 'suspended' : (worker.status === 'pending' ? 'suspended' : 'active') }
    }, {
      onError: (err: any) => toast.error(err.message || "স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে")
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full h-[85vh] sm:h-[80vh] flex flex-col p-0 gap-0 overflow-hidden rounded-t-3xl sm:rounded-2xl mt-auto sm:mt-0 bg-slate-50">
        <DialogHeader className="p-5 pb-4 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg",
              party.role === 'CUSTOMER' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            )}>
              {party.name.charAt(0)}
            </div>
            <div>
              <DialogTitle className="text-lg font-extrabold text-slate-900">{party.name}</DialogTitle>
              <p className="text-xs font-semibold text-slate-500 mt-1">
                {party.role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Invite Section */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3">
            <h3 className="text-sm font-bold text-slate-800">নতুন স্টাফকে এই কাস্টমার/সাপ্লায়ারের অ্যাক্সেস দিন</h3>
            <div className="flex gap-2">
              <Input
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="email@example.com"
                className="h-10 bg-slate-50"
              />
              <Button
                onClick={handleInvite}
                disabled={createWorker.isPending || !identity.trim() || !identity.includes('@')}
                className="h-10 px-4 bg-[#1B3A6B] hover:bg-[#142d55] shrink-0"
              >
                {createWorker.isPending ? "অপেক্ষা করুন..." : "যুক্ত করুন"}
              </Button>
            </div>
            <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex flex-col gap-1.5 mt-1">
              <p className="text-[11px] leading-relaxed text-blue-900 font-bold">
                কোনো ইমেইল পাঠানো হবে না। আপনাকে নিজে স্টাফকে এই ইমেইল দিয়ে অ্যাপে সাইন-ইন করতে বলতে হবে।
              </p>
            </div>
          </div>

          {/* Assigned Workers List */}
          <div>
            <h3 className="text-sm font-bold text-slate-800 mb-3 px-1">অ্যাসাইন করা স্টাফ</h3>
            {assignedWorkers.length === 0 ? (
              <div className="text-center p-6 text-slate-500 text-sm font-medium bg-white rounded-2xl border border-slate-200 shadow-sm">
                কাউকে এই কাস্টমার/সাপ্লায়ারের অ্যাক্সেস দেওয়া নেই
              </div>
            ) : (
              <div className="space-y-3">
                {assignedWorkers.map((w) => (
                  <div key={w.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          {w.identity.includes('@') ? <Mail className="w-4 h-4 text-slate-500" /> : <Phone className="w-4 h-4 text-slate-500" />}
                        </div>
                        <div>
                          <p className="font-bold text-[14px] text-slate-900 truncate">{w.identity}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              w.status === 'active' ? "bg-emerald-500" :
                              w.status === 'pending' ? "bg-amber-500" : "bg-red-500"
                            )} />
                            <span className="text-[10px] font-semibold text-slate-500">
                              {w.status === 'active' ? 'অ্যাক্টিভ' : w.status === 'pending' ? 'পেন্ডিং' : 'সাসপেন্ডেড'}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Note: the prompt says "pending/active/suspended and revoke/restore controls" */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-red-600 hover:text-red-700 hover:bg-red-50 font-bold text-xs rounded-lg"
                        onClick={() => handleRevoke(w.id, w.partyIds)}
                        disabled={updateWorker.isPending}
                      >
                        রিমুভ
                      </Button>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-slate-50">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleStatus(w)}
                        disabled={updateWorker.isPending}
                        className={cn("h-7 text-[11px] px-3 font-semibold flex-1 rounded-lg",
                          w.status === 'active' || w.status === 'pending' ? "text-red-600 hover:text-red-700 hover:bg-red-50 border-red-100" : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-100"
                        )}
                      >
                        {w.status === 'active' ? 'অ্যাকাউন্ট সাসপেন্ড' : w.status === 'pending' ? 'আমন্ত্রণ বাতিল করুন' : 'অ্যাকাউন্ট অ্যাক্টিভ করুন'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unassigned Workers List (optional, but requested implicitly by "restore controls" if they were removed?) */}
          {workers.filter(w => !w.partyIds.includes(party.id)).length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3 px-1 mt-4">অন্যান্য স্টাফ থেকে অ্যাক্সেস দিন</h3>
              <div className="space-y-2">
                {workers.filter(w => !w.partyIds.includes(party.id)).map(w => (
                  <div key={w.id} className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between">
                     <div className="flex items-center gap-2 min-w-0">
                       <p className="font-semibold text-[13px] text-slate-800 truncate">{w.identity}</p>
                     </div>
                     <Button
                       variant="outline"
                       size="sm"
                       className="h-7 px-3 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-[11px] font-bold rounded-lg border-emerald-100"
                       onClick={() => handleRestore(w.id, w.partyIds)}
                       disabled={updateWorker.isPending}
                     >
                       অ্যাক্সেস দিন
                     </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
