import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  useListParties,
  useGetDashboardSummary,
  useGetBusinessSettings,
  PartyRole,
  DueFilter,
} from '@workspace/api-client-react';
import { Search, Plus, Settings, User, ChevronRight } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { AddPartyModal } from '@/components/modals/add-party-modal';
import { SettingsDrawer } from '@/components/modals/settings-drawer';
import { formatDistanceToNow } from 'date-fns';
import { bn } from 'date-fns/locale';

export function HomeView() {
  const [role, setRole] = useState<PartyRole>(PartyRole.CUSTOMER);
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<DueFilter>(DueFilter.ALL);
  const [location] = useLocation();
  const [isAddPartyOpen, setIsAddPartyOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const { data: summary } = useGetDashboardSummary();
  const { data: settings } = useGetBusinessSettings();
  const { data: parties = [] } = useListParties({ role, search, dueFilter });

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {/* Sticky top header */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-[0_4px_20px_-15px_rgba(0,0,0,0.15)]">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shadow-sm shrink-0">
              হা
            </div>
            <div className="leading-tight min-w-0">
              <h1 className="font-extrabold tracking-tight text-lg text-slate-900 truncate">
                {settings?.storeName || 'হাজারী খাতাবুক'}
              </h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">খাতাবুক</p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            aria-label="সেটিংস"
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 active:scale-95 transition-all"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {/* Quick action bar: search + add */}
        <div className="flex items-center gap-2 px-4 pb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder={role === PartyRole.CUSTOMER ? 'কাস্টমার খুঁজুন...' : 'সাপ্লায়ার খুঁজুন...'}
              className="pl-10 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-primary/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setIsAddPartyOpen(true)}
            aria-label={role === PartyRole.CUSTOMER ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}
            className="w-11 h-11 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 pb-4">
          <div className="flex bg-slate-100 p-1.5 rounded-xl shadow-inner">
            <button
              onClick={() => setRole(PartyRole.CUSTOMER)}
              className={cn(
                'flex-1 text-sm font-bold py-2.5 rounded-lg transition-all active:scale-[0.98]',
                role === PartyRole.CUSTOMER
                  ? 'bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] text-primary'
                  : 'text-slate-500'
              )}
            >
              কাস্টমার (খরিদ্দার)
            </button>
            <button
              onClick={() => setRole(PartyRole.SUPPLIER)}
              className={cn(
                'flex-1 text-sm font-bold py-2.5 rounded-lg transition-all active:scale-[0.98]',
                role === PartyRole.SUPPLIER
                  ? 'bg-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] text-primary'
                  : 'text-slate-500'
              )}
            >
              সাপ্লায়ার (মহাজন)
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 active:scale-[0.97] transition-transform">
              <p className="text-[9px] font-bold text-emerald-600/80 uppercase tracking-widest mb-1">পাবেন</p>
              <p className="text-emerald-700 font-extrabold text-[15px] tracking-tight truncate">
                {formatCurrency(summary?.youWillGet || 0)}
              </p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-2xl p-3 active:scale-[0.97] transition-transform">
              <p className="text-[9px] font-bold text-red-500/80 uppercase tracking-widest mb-1">দেবেন</p>
              <p className="text-red-600 font-extrabold text-[15px] tracking-tight truncate">
                {formatCurrency(summary?.youWillGive || 0)}
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 active:scale-[0.97] transition-transform">
              <p className="text-[9px] font-bold text-blue-500/80 uppercase tracking-widest mb-1">অনলাইন কালেকশন</p>
              <p className="text-blue-700 font-extrabold text-[15px] tracking-tight truncate">
                {formatCurrency(summary?.onlineCollectionBalance || 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Due filters */}
        <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar -mx-0 px-4">
          {[
            { id: DueFilter.ALL, label: 'সব' },
            { id: DueFilter.DUE_TODAY, label: 'আজকের বকেয়া' },
            { id: DueFilter.UPCOMING, label: 'আসন্ন' },
            { id: DueFilter.NO_DUE_DATE, label: 'তারিখ ছাড়া' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setDueFilter(f.id)}
              className={cn(
                'whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95',
                dueFilter === f.id
                  ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                  : 'bg-white text-slate-500 border-slate-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contact feed list */}
      <div className="flex-1 overflow-y-auto bg-white">
        {parties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <User className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">
              {role === PartyRole.CUSTOMER ? 'কোনো কাস্টমার পাওয়া যায়নি।' : 'কোনো সাপ্লায়ার পাওয়া যায়নি।'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {parties.map((party, i) => (
              <Link
                key={party.id}
                href={`/party/${party.id}`}
                className={cn(
                  'flex items-center p-4 active:bg-slate-50 transition-all block w-full text-left relative',
                  location === `/party/${party.id}` && 'bg-blue-50/40',
                  'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both'
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div
                  className={cn(
                    'w-[52px] h-[52px] rounded-full flex items-center justify-center font-bold text-lg mr-4 shrink-0',
                    party.balanceType === 'YOU_WILL_GET' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  )}
                >
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
                <div className="text-right shrink-0 flex items-center gap-1.5">
                  <div>
                    <p
                      className={cn(
                        'text-[15px] font-bold tracking-tight',
                        party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(party.currentBalance)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 text-right">
                      {party.balanceType === 'YOU_WILL_GET' ? 'পাবেন' : 'দেবেন'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </div>
              </Link>
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>

      <AddPartyModal open={isAddPartyOpen} onOpenChange={setIsAddPartyOpen} defaultRole={role} />
      <SettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
