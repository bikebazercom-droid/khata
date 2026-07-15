import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { 
  useListParties, 
  useGetDashboardSummary, 
  useGetBusinessSettings, 
  PartyRole, 
  DueFilter 
} from '@workspace/api-client-react';
import { Search, UserPlus, User, ChevronRight } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AddPartyModal } from '@/components/modals/add-party-modal';
import { formatDistanceToNow } from 'date-fns';
import { bn } from 'date-fns/locale';

export function LeftPanel() {
  const [role, setRole] = useState<PartyRole>(PartyRole.CUSTOMER);
  const [search, setSearch] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>(DueFilter.ALL);
  const [location] = useLocation();
  const [isAddPartyOpen, setIsAddPartyOpen] = useState(false);

  const { data: summary } = useGetDashboardSummary();
  const { data: settings } = useGetBusinessSettings();
  const { data: parties = [] } = useListParties({ role, search, dueFilter });

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-20 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm">
            হা
          </div>
          <div className="leading-tight">
            <h1 className="font-bold tracking-tight text-lg text-slate-900">
              {settings?.storeName || "হাজারী খাতাবুক"}
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ডেক্সটপ</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs rounded-full font-semibold px-3 bg-slate-50 border-slate-200">
          <UserPlus className="w-3.5 h-3.5 mr-1.5" /> স্টাফ যোগ করুন
        </Button>
      </div>

      <div className="px-4 pt-5 bg-white border-b border-slate-100 shrink-0 relative z-10 shadow-[0_4px_20px_-15px_rgba(0,0,0,0.1)]">
        <div className="flex bg-slate-100 p-1.5 rounded-xl mb-5 shadow-inner">
          <button 
            onClick={() => setRole(PartyRole.CUSTOMER)}
            className={cn(
              "flex-1 text-sm font-bold py-2 rounded-lg transition-all",
              role === PartyRole.CUSTOMER ? "bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] text-primary" : "text-slate-500 hover:text-slate-800"
            )}
          >
            কাস্টমার (খরিদ্দার)
          </button>
          <button 
            onClick={() => setRole(PartyRole.SUPPLIER)}
            className={cn(
              "flex-1 text-sm font-bold py-2 rounded-lg transition-all",
              role === PartyRole.SUPPLIER ? "bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] text-primary" : "text-slate-500 hover:text-slate-800"
            )}
          >
            সাপ্লায়ার (মহাজন)
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm mb-5 relative overflow-hidden group">
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> পাবেন
              </p>
              <p className="text-emerald-600 font-bold text-base tracking-tight">{formatCurrency(summary?.youWillGet || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> দেবেন
              </p>
              <p className="text-red-500 font-bold text-base tracking-tight">{formatCurrency(summary?.youWillGive || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> অনলাইন কালেকশন
              </p>
              <p className="text-blue-600 font-bold text-base tracking-tight">{formatCurrency(summary?.onlineCollectionBalance || 0)}</p>
            </div>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <Input 
            placeholder={role === PartyRole.CUSTOMER ? "কাস্টমার খুঁজুন..." : "সাপ্লায়ার খুঁজুন..."}
            className="pl-10 h-10 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-primary/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide no-scrollbar -mx-4 px-4 mask-edge">
          {[
             { id: DueFilter.ALL, label: "সব" },
             { id: DueFilter.DUE_TODAY, label: "আজকের বকেয়া" },
             { id: DueFilter.UPCOMING, label: "আসন্ন" },
             { id: DueFilter.NO_DUE_DATE, label: "তারিখ ছাড়া" }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setDueFilter(f.id)}
              className={cn(
                "whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold border transition-all",
                dueFilter === f.id ? "bg-slate-800 text-white border-slate-800 shadow-md" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white pb-28 pt-2">
        {parties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <User className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">
              {role === PartyRole.CUSTOMER ? "কোনো কাস্টমার পাওয়া যায়নি।" : "কোনো সাপ্লায়ার পাওয়া যায়নি।"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {parties.map((party, i) => (
              <Link 
                key={party.id} 
                href={`/party/${party.id}`}
                className={cn(
                  "flex items-center p-4 hover:bg-slate-50 transition-all group cursor-pointer block w-full text-left relative",
                  location === `/party/${party.id}` && "bg-blue-50/40 hover:bg-blue-50/60",
                  "animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both"
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {location === `/party/${party.id}` && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"></div>
                )}
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg mr-4 shrink-0 transition-transform group-hover:scale-105",
                  party.balanceType === "YOU_WILL_GET" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                )}>
                  {party.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 pr-3">
                  <div className="flex justify-between items-center mb-1">
                    <p className="font-bold text-slate-900 truncate text-[15px]">{party.name}</p>
                    {party.lastTransactionAt && (
                      <span className="text-[10px] font-medium text-slate-400 shrink-0 ml-2">
                        {formatDistanceToNow(new Date(party.lastTransactionAt), { addSuffix: true, locale: bn })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-slate-500 truncate">{party.phone}</p>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <div>
                    <p className={cn(
                      "text-[15px] font-bold flex items-center justify-end gap-1 tracking-tight",
                      party.balanceType === "YOU_WILL_GET" ? "text-emerald-600" : "text-red-600"
                    )}>
                      {formatCurrency(party.currentBalance)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      {party.balanceType === "YOU_WILL_GET" ? "পাবেন" : "দেবেন"}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-white via-white/95 to-transparent pt-12 pointer-events-none">
        <div className="pointer-events-auto">
          <Button 
            className="w-full h-14 shadow-[0_4px_14px_0_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] font-bold text-base rounded-xl" 
            onClick={() => setIsAddPartyOpen(true)}
          >
            <UserPlus className="w-5 h-5 mr-2" />
            + নতুন কাস্টমার/সাপ্লায়ার যোগ করুন
          </Button>
        </div>
      </div>

      <AddPartyModal 
        open={isAddPartyOpen} 
        onOpenChange={setIsAddPartyOpen} 
        defaultRole={role} 
      />
    </div>
  );
}
