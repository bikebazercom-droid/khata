import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  useListParties,
  useGetDashboardSummary,
  useGetBusinessSettings,
  PartyRole,
  DueFilter,
} from '@workspace/api-client-react';
import { Search, Plus, Settings, User, ChevronRight, UserPlus2, SlidersHorizontal, FileText, Users, Pencil, FolderOpen } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { AddPartyModal } from '@/components/modals/add-party-modal';
import { SettingsDrawer } from '@/components/modals/settings-drawer';
import { AddStaffDialog } from '@/components/modals/add-staff-dialog';
import { RenameStoreDialog } from '@/components/modals/rename-store-dialog';
import { formatDistanceToNow } from 'date-fns';
import { bn } from 'date-fns/locale';

export function HomeView() {
  const [role, setRole] = useState<PartyRole>(PartyRole.CUSTOMER);
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<DueFilter>(DueFilter.ALL);
  const [showDueFilters, setShowDueFilters] = useState(false);
  const [location, navigate] = useLocation();
  const [isAddPartyOpen, setIsAddPartyOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [isRenameStoreOpen, setIsRenameStoreOpen] = useState(false);

  const { data: summary } = useGetDashboardSummary();
  const { data: settings } = useGetBusinessSettings();
  const { data: parties = [] } = useListParties({ role, search, dueFilter });

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* Fixed deep-blue top header */}
      <div className="shrink-0 bg-[#1B3A6B] pb-9 z-10">
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(1rem+var(--safe-top))]">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/logo-icon.svg`}
              alt="ডিজিটাল খাতা"
              className="w-9 h-9 shrink-0"
            />
            <h1 className="font-extrabold tracking-tight text-[15px] text-white truncate max-w-[120px]">
              {settings?.storeName || 'ডিজিটাল খাতা'}
            </h1>
            <button
              onClick={() => setIsRenameStoreOpen(true)}
              aria-label="দোকানের নাম সম্পাদনা করুন"
              className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-white/60 active:bg-white/15 active:text-white transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate('/staff-deployment')}
              className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-bold px-3 py-2 rounded-xl active:scale-95 transition-all"
            >
              <UserPlus2 className="w-3.5 h-3.5" />
              স্টাফ যোগ করুন
            </button>
            <button
              onClick={() => navigate('/staff-deployment')}
              aria-label="ডিউটি ফোল্ডার"
              className="w-9 h-9 rounded-xl bg-white/15 text-white flex items-center justify-center active:scale-95 active:bg-white/25 transition-all"
            >
              <FolderOpen className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4">
          <div className="flex items-stretch gap-6 border-b border-white/15">
            <button
              onClick={() => setRole(PartyRole.CUSTOMER)}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                role === PartyRole.CUSTOMER ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              গ্রাহক
            </button>
            <button
              onClick={() => setRole(PartyRole.SUPPLIER)}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                role === PartyRole.SUPPLIER ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              সরবরাহকারী
            </button>
          </div>
        </div>
      </div>

      {/* Overlapping white "3-in-1" summary card */}
      <div className="shrink-0 px-4 -mt-6 z-10">
        <div className="bg-white rounded-2xl shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)] border border-slate-100 grid grid-cols-3 divide-x divide-slate-100">
          <div className="px-1.5 py-3 text-center min-w-0">
            <p className="text-emerald-700 font-extrabold text-[13px] tracking-tight truncate">
              {formatCurrency(summary?.youWillGive || 0)}
            </p>
            <p className="text-[9.5px] font-semibold text-slate-400 mt-1 whitespace-nowrap">আপনি দেবেন</p>
          </div>
          <div className="px-1.5 py-3 text-center min-w-0">
            <p className="text-red-600 font-extrabold text-[13px] tracking-tight truncate">
              {formatCurrency(summary?.youWillGet || 0)}
            </p>
            <p className="text-[9.5px] font-semibold text-slate-400 mt-1 whitespace-nowrap">আপনি পাবেন</p>
          </div>
          <Link
            href="/reports"
            className="px-1.5 py-3 flex flex-col items-center justify-center gap-1 active:scale-[0.95] transition-all min-w-0"
          >
            <span className="flex items-center gap-1 text-[#075E9F] font-bold text-[12px] whitespace-nowrap">
              রিপোর্ট দেখুন
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </span>
          </Link>
        </div>
      </div>

      {/* Utility bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder={role === PartyRole.CUSTOMER ? 'কাস্টমার অনুসন্ধান করুন' : 'সাপ্লায়ার অনুসন্ধান করুন'}
            className="pl-10 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-primary/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowDueFilters((v) => !v)}
          aria-label="ফিল্টার"
          className={cn(
            'w-14 h-11 shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all',
            showDueFilters ? 'bg-primary text-primary-foreground' : 'bg-slate-50 text-slate-500 border border-slate-200'
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-[9px] font-bold leading-none">ফিল্টার</span>
        </button>
        <Link
          href="/reports"
          aria-label="PDF রিপোর্ট"
          className="w-14 h-11 shrink-0 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all"
        >
          <FileText className="w-4 h-4" />
          <span className="text-[9px] font-bold leading-none">PDF</span>
        </Link>
      </div>

      {/* Due filters (toggleable) */}
      {showDueFilters && (
        <div className="shrink-0 flex gap-2 overflow-x-auto pb-3 no-scrollbar px-4">
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
      )}

      {/* Contact feed list — the only scrollable section */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white pb-24">
        {parties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-8 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <User className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">
              {role === PartyRole.CUSTOMER
                ? 'কাস্টমার যোগ করুন এবং দ্রুত বকেয়া কালেকশন করুন'
                : 'সাপ্লায়ার যোগ করুন এবং আপনার হিসাব পরিষ্কার রাখুন'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {parties.map((party, i) => (
              <Link
                key={party.id}
                href={`/party/${party.id}`}
                className={cn(
                  'flex items-center justify-between p-4 active:bg-slate-50 transition-all w-full text-left relative',
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

      {/* Floating FAB */}
      <button
        onClick={() => setIsAddPartyOpen(true)}
        className="absolute right-4 bottom-[76px] z-20 flex items-center gap-2 bg-[#F5A623] text-white font-bold text-sm pl-4 pr-5 py-3.5 rounded-full shadow-[0_8px_24px_-6px_rgba(245,166,35,0.55)] active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        {role === PartyRole.CUSTOMER ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}
      </button>

      {/* Sticky bottom nav */}
      <div className="shrink-0 flex items-stretch border-t border-slate-100 bg-white z-10 pb-[var(--safe-bottom)]">
        <button className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[#1B3A6B]">
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-bold">পার্টিস</span>
        </button>
        <Link
          href="/reports"
          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-slate-400 active:text-slate-600 transition-colors"
        >
          <FileText className="w-5 h-5" />
          <span className="text-[10px] font-bold">রিপোর্ট</span>
        </Link>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-slate-400 active:text-slate-600 transition-colors"
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] font-bold">সেটিংস</span>
        </button>
      </div>

      <AddPartyModal open={isAddPartyOpen} onOpenChange={setIsAddPartyOpen} defaultRole={role} />
      <SettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <AddStaffDialog open={isAddStaffOpen} onOpenChange={setIsAddStaffOpen} />
      <RenameStoreDialog open={isRenameStoreOpen} onOpenChange={setIsRenameStoreOpen} />
    </div>
  );
}
