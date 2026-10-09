import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import { queuePartyOperation } from '@/lib/partyOutbox';
import { readOfflineIdentity } from '@/lib/offlineSession';
import { isTransientNetworkError } from '@/lib/offlineErrors';
import { canSelectDeviceContacts, selectDeviceContacts, type DeviceContact } from '@/lib/device-contacts';
import { formatBangladeshPhoneForInput, normalizeBangladeshPhone } from '@/lib/bangladesh-phone';
import {
  useCreateParty,
  PartyRole,
  BalanceType,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
  type Party,
  type DashboardSummary,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Search, X, UserPlus, Contact as ContactIcon, Users, AlertCircle, ArrowRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { summaryContribution } from '@/lib/optimistic';

const formSchema = z.object({
  name: z.string().trim().min(1, 'নাম আবশ্যক'),
  phone: z.string().optional(),
  role: z.nativeEnum(PartyRole),
  openingBalance: z.coerce.number().optional(),
  openingBalanceType: z.nativeEnum(BalanceType).optional(),
});
type DirectoryContact = DeviceContact;

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '•';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function contactIndexLetter(name: string): string {
  const first = [...name.trim()][0] ?? '#';
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  return /\p{L}/u.test(first) ? first.toLocaleUpperCase() : '#';
}

function compareIndexLetters(left: string, right: string): number {
  if (left === '#') return right === '#' ? 0 : 1;
  if (right === '#') return -1;
  const leftIsLatin = /^[A-Z]$/.test(left);
  const rightIsLatin = /^[A-Z]$/.test(right);
  if (leftIsLatin !== rightIsLatin) return leftIsLatin ? -1 : 1;
  return left.localeCompare(right, leftIsLatin ? 'en' : 'bn', { sensitivity: 'base' });
}

export function AddPartyModal({
  open,
  onOpenChange,
  defaultRole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRole: PartyRole;
}) {
  const [step, setStep] = useState<'contacts' | 'form'>('contacts');
  const [prefill, setPrefill] = useState<{ name: string; phone: string } | undefined>();

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#fbfcfe] text-[#1c3049]">
      {step === 'contacts' ? (
        <ContactDirectoryScreen
          role={defaultRole}
          onClose={() => onOpenChange(false)}
          onManualAdd={() => { setPrefill(undefined); setStep('form'); }}
          onPickContact={(contact) => { setPrefill(contact); setStep('form'); }}
        />
      ) : (
        <AddPartyForm
          defaultRole={defaultRole}
          prefill={prefill}
          onBack={() => setStep('contacts')}
          onDone={() => { setStep('contacts'); onOpenChange(false); }}
        />
      )}
    </div>
  );
}

function ContactDirectoryScreen({
  role, onClose, onManualAdd, onPickContact,
}: {
  role: PartyRole;
  onClose: () => void;
  onManualAdd: () => void;
  onPickContact: (contact: { name: string; phone: string }) => void;
}) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<DirectoryContact[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [importFailed, setImportFailed] = useState(false);
  const filtered = useMemo(() => (contacts ?? []).filter((contact) =>
    contact.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) || contact.phone.includes(search)
  ), [contacts, search]);
  const grouped = useMemo(() => {
    const groups = new Map<string, DirectoryContact[]>();
    for (const contact of filtered) {
      const letter = contactIndexLetter(contact.name);
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)?.push(contact);
    }
    const collator = new Intl.Collator('bn', { sensitivity: 'base' });
    for (const entries of groups.values()) entries.sort((a, b) => collator.compare(a.name, b.name));
    return new Map([...groups.entries()].sort(([left], [right]) => compareIndexLetters(left, right)));
  }, [filtered]);
  const indexLetters = useMemo(() => [...grouped.keys()], [grouped]);

  const importContacts = async () => {
    setImportMessage('');
    setImportFailed(false);
    if (!canSelectDeviceContacts()) {
      setImportFailed(true);
      setImportMessage('এই ডিভাইসে কন্টাক্ট আমদানি করা যাচ্ছে না। নাম দিয়ে ম্যানুয়ালি যোগ করুন।');
      return;
    }
    setImporting(true);
    try {
      const selected = await selectDeviceContacts();
      setContacts(selected);
      if (!selected.length) setImportMessage('কোনো কন্টাক্ট বেছে নেওয়া হয়নি। চাইলে ম্যানুয়ালি যোগ করুন।');
    } catch (error) {
      setImportFailed(true);
      setImportMessage(error instanceof Error ? error.message : 'কন্টাক্ট আনা যায়নি। আবার চেষ্টা করুন বা ম্যানুয়ালি যোগ করুন।');
    } finally {
      setImporting(false);
    }
  };

  const jumpTo = (letter: string) => {
    document.getElementById(`party-letter-${letter}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const roleName = role === PartyRole.CUSTOMER ? 'কাস্টমার' : 'সাপ্লায়ার';
  const hasContacts = contacts !== null && contacts.length > 0;

  return (
    <>
      <header className="shrink-0 border-b border-[#e4eaf1] bg-white px-4 pb-4 pt-[calc(1rem+var(--safe-top))]">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <button type="button" onClick={onClose} aria-label="বন্ধ করুন" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#50657e] transition hover:bg-[#f1f5f9] active:scale-95">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#7890a8]">BanglaKhata · খাতা</p>
            <h2 className="text-lg font-extrabold text-[#17365b]">{roleName} নির্বাচন করুন</h2>
          </div>
          <span className="ml-auto grid h-10 w-10 place-items-center rounded-2xl bg-[#edf4fc] text-[#1758a8]">
            <Users className="h-5 w-5" />
          </span>
        </div>
      </header>

      <div className="z-10 shrink-0 border-b border-[#e5ebf2] bg-[#fbfcfe] px-4 pb-3 pt-4">
        <div className="mx-auto max-w-xl">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8497aa]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`${roleName}র নাম / নম্বর খুঁজুন`}
              aria-label="কন্টাক্ট খুঁজুন"
              className="h-12 rounded-2xl border-[#dfe7ef] bg-white pl-11 pr-11 text-[15px] shadow-[0_2px_8px_rgba(22,52,85,.03)] placeholder:text-[#91a0af] focus-visible:ring-[#3975b9]/25"
            />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="খোঁজা মুছুন" className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#8294a7] hover:bg-[#f0f4f8]"><X className="h-4 w-4" /></button>}
          </label>

          <button type="button" onClick={onManualAdd} className="mt-3 flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left transition hover:bg-[#f1f6fb] active:scale-[.99]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-dashed border-[#8ca8c6] bg-white text-[#15549c]"><UserPlus className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-[#174879]">নতুন {roleName} ম্যানুয়ালি যোগ করুন</span>
              <span className="mt-0.5 block text-xs text-[#8192a4]">শুধু নাম দিলেই খাতা তৈরি হবে</span>
            </span>
            <ArrowRight className="mr-2 h-4 w-4 text-[#8298ae]" />
          </button>

          <button type="button" onClick={importContacts} disabled={importing} className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#d8e5f2] bg-[#eff6fc] text-sm font-bold text-[#215b96] transition hover:bg-[#e5f0fa] active:scale-[.99] disabled:opacity-60">
            {importing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#9bb9d6] border-t-[#1758a8]" /> : <ContactIcon className="h-4 w-4" />}
            {importing ? 'কন্টাক্ট আনা হচ্ছে…' : contacts ? 'আবার কন্টাক্ট বেছে নিন' : 'ফোন কন্টাক্ট থেকে বেছে নিন'}
          </button>
          {importMessage && (
            <div role="status" className={cn('mt-2 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-5', importFailed ? 'bg-[#fff4ed] text-[#8b4d22]' : 'bg-[#f1f6fb] text-[#55718d]')}>
              {importFailed && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{importMessage}</span>
              {importFailed && <button type="button" onClick={onManualAdd} className="ml-auto shrink-0 font-bold text-[#1758a8] underline underline-offset-2">ম্যানুয়ালি যোগ</button>}
            </div>
          )}
        </div>
      </div>

      <section className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="কন্টাক্ট তালিকা">
        <div className="mx-auto min-h-full max-w-xl px-4 pb-[calc(1.5rem+var(--safe-bottom))]">
          {contacts === null ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-8 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-[22px] bg-[#edf4fb] text-[#7391af]"><ContactIcon className="h-7 w-7" /></span>
              <p className="mt-4 text-sm font-bold text-[#405a74]">কন্টাক্ট বেছে নিলে এখানে দেখা যাবে</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-[#8b9aaa]">আপনার ফোনের তালিকা শুধু এই নির্বাচনের জন্য ব্যবহার হবে; সংরক্ষণ করা হয় না।</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center px-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#f0f4f8] text-[#92a2b2]"><Search className="h-6 w-6" /></span>
              <p className="mt-4 text-sm font-bold text-[#405a74]">{contacts.length ? 'এই নামে কোনো কন্টাক্ট নেই' : 'কোনো কন্টাক্ট বেছে নেওয়া হয়নি'}</p>
              <p className="mt-1 text-xs text-[#8b9aaa]">অন্য নামে খুঁজুন অথবা ম্যানুয়ালি যোগ করুন।</p>
              <button type="button" onClick={onManualAdd} className="mt-4 rounded-xl bg-[#eaf2fa] px-4 py-2 text-sm font-bold text-[#1758a8]">ম্যানুয়ালি যোগ করুন</button>
            </div>
          ) : (
            <div className="pb-3 pr-6">
              {Array.from(grouped.entries()).map(([letter, entries]) => (
                <div key={letter} id={`party-letter-${letter}`} className="scroll-mt-2">
                  <p className="sticky top-0 z-[1] bg-[#fbfcfe]/95 px-1 pb-1 pt-4 text-[11px] font-extrabold uppercase tracking-[.18em] text-[#8397aa] backdrop-blur">{letter}</p>
                  {entries.map((contact) => (
                    <button key={contact.id} type="button" onClick={() => onPickContact({ name: contact.name, phone: contact.phone })} className="group flex w-full items-center gap-3 border-b border-[#e9eef3] py-3 text-left transition-colors hover:bg-white active:bg-[#edf4fb]">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e7f0f9] text-sm font-extrabold text-[#285d91]">{initialsOf(contact.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-bold leading-5 text-[#263e57]">{contact.name}</span>
                        {contact.phone && <span className="mt-0.5 block break-all text-xs leading-4 text-[#7c8d9f]">{contact.phone}</span>}
                      </span>
                      <Plus className="mr-1 h-4 w-4 shrink-0 text-[#8da3b8] transition group-hover:text-[#1758a8]" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {hasContacts && (
          <nav aria-label="নামের অক্ষর অনুযায়ী যান" className="absolute bottom-2 right-0 top-2 flex w-7 flex-col items-center justify-start gap-0.5 overflow-y-auto overscroll-contain py-2">
            {indexLetters.map((letter) => (
              <button key={letter} type="button" onClick={() => jumpTo(letter)} aria-label={`${letter} অক্ষরের কন্টাক্ট`} className="min-h-5 w-6 rounded text-[10px] font-extrabold leading-5 text-[#1d5c9b] transition-colors hover:bg-[#e6eef7]">{letter}</button>
            ))}
          </nav>
        )}
      </section>
    </>
  );
}

function AddPartyForm({
  defaultRole, prefill, onBack, onDone,
}: {
  defaultRole: PartyRole;
  prefill?: { name: string; phone: string };
  onBack: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { selectedBusinessId } = useBusinessContext();
  const createParty = useCreateParty({
    mutation: {
      networkMode: 'always',
      onMutate: async ({ data }) => {
        const partiesKey = businessScopedQueryKey(getListPartiesQueryKey(), selectedBusinessId);
        const summaryKey = businessScopedQueryKey(getGetDashboardSummaryQueryKey(), selectedBusinessId);
        const previousParties = queryClient.getQueryData<Party[]>(partiesKey);
        const previousSummary = queryClient.getQueryData<DashboardSummary>(summaryKey);
        const openingBalance = data.openingBalance ?? 0;
        const optimisticParty: Party = {
          id: data.id ?? crypto.randomUUID(), name: data.name, phone: data.phone ?? '',
          role: data.role, currentBalance: openingBalance,
          balanceType: data.openingBalanceType ?? BalanceType.YOU_WILL_GET,
          dueDate: data.dueDate ?? null,
          lastTransactionAt: openingBalance > 0 ? new Date().toISOString() : null,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<Party[]>(partiesKey, (old) => [optimisticParty, ...(old ?? [])]);
        if (previousSummary) {
          const contribution = summaryContribution(optimisticParty);
          queryClient.setQueryData<DashboardSummary>(summaryKey, {
            ...previousSummary,
            youWillGet: previousSummary.youWillGet + contribution.get,
            youWillGive: previousSummary.youWillGive + contribution.give,
            customerCount: previousSummary.customerCount + (data.role === PartyRole.CUSTOMER ? 1 : 0),
            supplierCount: previousSummary.supplierCount + (data.role === PartyRole.SUPPLIER ? 1 : 0),
          });
        }
        return { partiesKey, summaryKey, previousParties, previousSummary, optimisticParty };
      },
      onError: async (err, vars, context) => {
        const identity = readOfflineIdentity();
        const businessId = selectedBusinessId ?? identity?.businessId;
        if (isTransientNetworkError(err) && context?.optimisticParty && identity && businessId) {
          try {
            await queuePartyOperation({
              id: crypto.randomUUID(), actorId: identity.userId, businessId,
              partyId: context.optimisticParty.id, kind: 'create',
              data: { ...vars.data, id: context.optimisticParty.id },
              optimisticParty: context.optimisticParty, createdAt: new Date().toISOString(), status: 'pending',
            });
            toast.success('খাতায় সেভ হয়েছে; সংযোগ ফিরলে সিঙ্ক হবে');
            return;
          } catch {
            toast.error('অফলাইন স্টোরেজে সেভ করা যায়নি');
          }
        }
        console.error('কাস্টমার/সাপ্লায়ার যুক্ত করা ব্যর্থ হয়েছে, পরিবর্তন ফিরিয়ে নেওয়া হচ্ছে:', err);
        toast.error('যোগ করা যায়নি। আবার চেষ্টা করুন।');
        if (!context) return;
        queryClient.setQueryData(context.partiesKey, context.previousParties);
        queryClient.setQueryData(context.summaryKey, context.previousSummary);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: ['owner-parties'] });
      },
    },
  });
  const {
    register, handleSubmit, formState: { errors }, watch, setValue,
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: prefill?.name ?? '',
      phone: prefill?.phone ? formatBangladeshPhoneForInput(prefill.phone) : '',
      role: defaultRole, openingBalance: 0, openingBalanceType: BalanceType.YOU_WILL_GET,
    },
  });
  const currentRole = watch('role');
  const balanceType = watch('openingBalanceType');
  const isCustomer = currentRole === PartyRole.CUSTOMER;

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const phone = normalizeBangladeshPhone(values.phone ?? '');
    onDone();
    createParty.mutate({
      data: {
        id: crypto.randomUUID(),
        name: values.name.trim(),
        ...(phone ? { phone } : {}),
        role: values.role,
        ...(values.openingBalance ? { openingBalance: values.openingBalance, openingBalanceType: values.openingBalanceType } : {}),
      },
    });
  };

  return (
    <>
      <header className="shrink-0 bg-[#1558a5] px-4 pb-4 pt-[calc(1rem+var(--safe-top))] text-white">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <button type="button" onClick={onBack} aria-label="পিছনে যান" className="grid h-10 w-10 place-items-center rounded-full text-white/90 transition hover:bg-white/10 active:scale-95"><ChevronLeft className="h-5 w-5" /></button>
          <div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-white/65">নতুন খাতা</p><h2 className="text-lg font-extrabold">{isCustomer ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}</h2></div>
        </div>
      </header>
      <form onSubmit={handleSubmit(onSubmit)} className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <div>
            <label className="mb-2 block text-sm font-bold text-[#344c65]">{isCustomer ? 'কাস্টমারের নাম' : 'সাপ্লায়ারের নাম'} <span className="text-[#b84d38]">*</span></label>
            <Input {...register('name')} autoFocus placeholder="যেমন: রহিম স্টোর" className="h-[54px] rounded-xl border-[#d9e2eb] bg-white px-4 text-base placeholder:text-[#98a5b2] focus-visible:ring-[#3474b7]/25" />
            {errors.name && <p role="alert" className="mt-1.5 text-xs font-semibold text-[#b84d38]">{errors.name.message}</p>}
            <p className="mt-2 text-xs text-[#8191a1]">নামই যথেষ্ট—ফোন নম্বর পরে যোগ করতে পারবেন।</p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-[#344c65]">মোবাইল নম্বর <span className="font-normal text-[#8b99a7]">(ঐচ্ছিক)</span></label>
            <div className="flex gap-2">
              <div className="flex h-[52px] shrink-0 items-center gap-2 rounded-xl border border-[#dce4ec] bg-[#f3f6f9] px-3.5 text-[#455d74]">
                <svg aria-label="বাংলাদেশের পতাকা" role="img" viewBox="0 0 30 20" className="h-4 w-6 overflow-hidden rounded-[2px] shadow-sm"><rect width="30" height="20" fill="#006a4e" /><circle cx="13.5" cy="10" r="5.4" fill="#f42a41" /></svg>
                <span className="text-sm font-extrabold tracking-wide">BD +880</span>
              </div>
              <Input {...register('phone')} inputMode="tel" autoComplete="tel-national" placeholder="01XXXXXXXXX" className="h-[52px] min-w-0 flex-1 rounded-xl border-[#d9e2eb] bg-white px-4 text-base tracking-wide placeholder:text-[#9aa8b6] focus-visible:ring-[#3474b7]/25" />
            </div>
            {errors.phone && <p role="alert" className="mt-1.5 text-xs font-semibold text-[#b84d38]">{errors.phone.message}</p>}
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-[#344c65]">তারা কে?</label>
            <div role="radiogroup" aria-label="পার্টির ধরন" className="grid grid-cols-2 gap-1 rounded-xl bg-[#edf1f5] p-1">
              {[
                { value: PartyRole.CUSTOMER, label: 'কাস্টমার' },
                { value: PartyRole.SUPPLIER, label: 'সাপ্লায়ার' },
              ].map((option) => (
                <label key={option.value} className={cn('flex min-h-11 cursor-pointer items-center justify-center rounded-lg text-sm font-bold transition-all', currentRole === option.value ? 'bg-white text-[#1758a8] shadow-[0_1px_4px_rgba(24,49,74,.12)]' : 'text-[#778797] hover:text-[#405a74]')}>
                  <input type="radio" className="sr-only" checked={currentRole === option.value} onChange={() => setValue('role', option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-[#e5eaf0] pt-5">
            <label className="mb-2 block text-sm font-bold text-[#344c65]">শুরুর ব্যালেন্স <span className="font-normal text-[#8b99a7]">(ঐচ্ছিক)</span></label>
            <div className="flex gap-2.5">
              <div className="relative min-w-0 flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-[#8292a1]">৳</span>
                <Input type="number" inputMode="decimal" min="0" {...register('openingBalance')} placeholder="0" className="h-[52px] rounded-xl border-[#d9e2eb] bg-white pl-10 text-base font-semibold focus-visible:ring-[#3474b7]/25" />
              </div>
              <select {...register('openingBalanceType')} aria-label="ব্যালেন্সের ধরন" className={cn('h-[52px] min-w-[112px] flex-1 rounded-xl border px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3474b7]/20', balanceType === BalanceType.YOU_WILL_GET ? 'border-[#cde8dc] bg-[#f0faf5] text-[#287655]' : 'border-[#f0d7ce] bg-[#fff5f1] text-[#a4543a]')}>
                <option value={BalanceType.YOU_WILL_GET}>পাবেন</option>
                <option value={BalanceType.YOU_WILL_GIVE}>দেবেন</option>
              </select>
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-[#e4eaf0] bg-white px-5 pb-[calc(1rem+var(--safe-bottom))] pt-3">
          <Button type="submit" disabled={!watch('name')?.trim() || createParty.isPending} className="h-[54px] w-full rounded-xl bg-[#1558a5] text-base font-extrabold text-white shadow-[0_5px_14px_rgba(21,88,165,.2)] transition hover:bg-[#104a8c] active:scale-[.99] disabled:bg-[#9ab7d8]">
            {createParty.isPending ? 'যোগ করা হচ্ছে…' : isCustomer ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}
          </Button>
        </div>
      </form>
    </>
  );
}
