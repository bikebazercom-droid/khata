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
import { ChevronLeft, Search, X, Contact as ContactIcon, AlertCircle, ArrowRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { summaryContribution } from '@/lib/optimistic';

const formSchema = z.object({
  name: z.string().trim().min(1, 'নাম আবশ্যক'),
  phone: z.string().optional(),
  role: z.nativeEnum(PartyRole),
});
type DirectoryContact = DeviceContact;

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function isPhoneOnlyContact(contact: DirectoryContact): boolean {
  const nameDigits = contact.name.replace(/\D/g, '');
  const phoneDigits = contact.phone.replace(/\D/g, '');
  return nameDigits.length >= 7 && (!phoneDigits || nameDigits === phoneDigits);
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
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-[#1c3049]">
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
  const roleName = role === PartyRole.CUSTOMER ? 'গ্রাহক' : 'সাপ্লায়ার';
  const hasContacts = contacts !== null && contacts.length > 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const additionalLetters = indexLetters.filter((letter) => !/^[A-Z]$/.test(letter) && letter !== '#');
  const visibleIndex = [...alphabet, ...(grouped.has('#') ? ['#'] : []), ...additionalLetters];

  return (
    <>
      <header className="h-[calc(88px+var(--safe-top))] shrink-0 bg-[#0b57d0] text-white">
        <div className="mx-auto flex h-full w-full max-w-xl items-end gap-3 px-4 pb-3 pt-[var(--safe-top)]">
          <button type="button" onClick={onClose} aria-label="বন্ধ করুন" data-testid="button-close-party-picker" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h2 className="pb-2 text-lg font-extrabold">{roleName} নির্বাচন করুন</h2>
        </div>
      </header>

      <div className="z-10 shrink-0 bg-white px-5 pb-2 pt-4">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center gap-2">
            <label className="relative block min-w-0 flex-1">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={role === PartyRole.CUSTOMER ? 'গ্রাহকের নাম' : 'সাপ্লায়ারের নাম'}
                aria-label={role === PartyRole.CUSTOMER ? 'গ্রাহকের নাম খুঁজুন' : 'সাপ্লায়ারের নাম খুঁজুন'}
                data-testid="input-party-search"
                className="h-[54px] rounded-[14px] border-[#d8dce1] bg-white pl-4 pr-12 text-base placeholder:text-[#8b9198] focus-visible:border-[#0b57d0] focus-visible:ring-2 focus-visible:ring-[#0b57d0]/15"
              />
              <Search className="absolute right-4 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-[#17202a]" />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="খোঁজা মুছুন" className="absolute right-11 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#8294a7] hover:bg-[#f0f4f8]"><X className="h-4 w-4" /></button>}
            </label>
            <button type="button" onClick={importContacts} disabled={importing} aria-label="ফোনের কন্টাক্ট থেকে বেছে নিন" title="ফোনের কন্টাক্ট থেকে বেছে নিন" data-testid="button-import-device-contacts" className="grid h-[54px] w-[48px] shrink-0 place-items-center rounded-[12px] border border-[#d8dce1] bg-white text-[#0b57d0] transition hover:bg-[#f5f8fc] active:scale-95 disabled:opacity-60">
              {importing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#9bb9d6] border-t-[#0b57d0]" /> : <ContactIcon className="h-5 w-5" />}
            </button>
          </div>

          <button type="button" onClick={onManualAdd} data-testid="button-party-add" className="mt-4 flex min-h-[64px] w-full items-center gap-4 rounded-xl px-1 text-left text-[#0b4d8f] transition hover:bg-[#f5f8fc] active:scale-[.99]">
            <span className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full border-2 border-dashed border-[#8ea9c2] bg-white text-[#0b57d0]"><Plus className="h-7 w-7" /></span>
            <span className="min-w-0 flex-1 text-base font-bold">{roleName} যুক্ত করুন</span>
            <ArrowRight className="mr-2 h-5 w-5 shrink-0 text-[#0b4d8f]" />
          </button>
          {importMessage && (
            <div role="status" data-testid="status-contact-import" className={cn('mt-1 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-5', importFailed ? 'bg-[#fff4ed] text-[#8b4d22]' : 'bg-[#f1f6fb] text-[#55718d]')}>
              {importFailed && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{importMessage}</span>
              {importFailed && <button type="button" onClick={onManualAdd} className="ml-auto shrink-0 font-bold text-[#1758a8] underline underline-offset-2">ম্যানুয়ালি যোগ</button>}
            </div>
          )}
        </div>
      </div>

      <section className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="কন্টাক্ট তালিকা">
        <div className="mx-auto min-h-full max-w-xl px-3 pb-[calc(1.5rem+var(--safe-bottom))]">
          {contacts === null ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center px-8 text-center">
              <ContactIcon className="h-8 w-8 text-[#aab4bf]" />
              <p className="mt-3 text-sm font-medium text-[#7f8993]">কন্টাক্ট বেছে নিলে এখানে দেখা যাবে</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-8 text-center">
              <Search className="h-7 w-7 text-[#aab4bf]" />
              <p className="mt-3 text-sm font-medium text-[#7f8993]">{contacts.length ? 'এই নামে কোনো কন্টাক্ট নেই' : 'কোনো কন্টাক্ট বেছে নেওয়া হয়নি'}</p>
            </div>
          ) : (
            <div className="pb-3 pr-7">
              {Array.from(grouped.entries()).map(([letter, entries]) => (
                <div key={letter} id={`party-letter-${letter}`} className="scroll-mt-2">
                  <p className="sticky top-0 z-[1] bg-white/95 px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#a0a8b1] backdrop-blur">{letter}</p>
                  {entries.map((contact) => (
                    <button key={contact.id} type="button" onClick={() => onPickContact({ name: contact.name, phone: contact.phone })} data-testid={`button-select-contact-${contact.id}`} className="flex min-h-[94px] w-full items-center gap-4 border-b border-[#eef0f2] px-2 py-3 text-left transition-colors hover:bg-[#f9fbfd] active:bg-[#f1f5f9]">
                      <span className="grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full bg-[#0b4d8f] text-[18px] font-medium text-white">
                        {isPhoneOnlyContact(contact) ? <Plus className="h-7 w-7" /> : initialsOf(contact.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[16px] font-medium leading-6 text-[#191f25]">{contact.name}</span>
                        {contact.phone && <span className="mt-1 block whitespace-nowrap text-sm leading-5 text-[#9aa0a6]">{contact.phone}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {hasContacts && (
          <nav aria-label="নামের অক্ষর অনুযায়ী যান" className="absolute bottom-1 right-0 top-1 flex w-6 flex-col items-center justify-between overflow-y-auto overscroll-contain py-2">
            {visibleIndex.map((letter) => (
              <button key={letter} type="button" onClick={() => grouped.has(letter) && jumpTo(letter)} disabled={!grouped.has(letter)} aria-label={`${letter} অক্ষরের কন্টাক্ট`} data-testid={`button-party-index-${letter}`} className={cn('grid min-h-[18px] w-5 flex-1 place-items-center rounded text-[9px] font-medium leading-none transition-colors', grouped.has(letter) ? 'text-[#53606d] hover:bg-[#e9f0f7]' : 'text-[#aeb5bc]')}>{letter}</button>
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
      role: defaultRole,
    },
  });
  const currentRole = watch('role');
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
      },
    });
  };

  return (
    <>
      <header className="h-[calc(88px+var(--safe-top))] shrink-0 bg-[#0b57d0] text-white">
        <div className="mx-auto flex h-full w-full max-w-xl items-end gap-3 px-4 pb-3 pt-[var(--safe-top)]">
          <button type="button" onClick={onBack} aria-label="পিছনে যান" data-testid="button-back-party-form" className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"><ChevronLeft className="h-6 w-6" /></button>
          <h2 className="pb-2 text-lg font-extrabold">পার্টি যুক্ত করুন</h2>
        </div>
      </header>
      <form onSubmit={handleSubmit(onSubmit)} className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-6">
          <div>
            <label htmlFor="party-name" className="sr-only">পার্টির নাম</label>
            <Input id="party-name" {...register('name')} placeholder="পার্টির নাম" data-testid="input-party-name" className="h-[72px] rounded-[5px] border-2 border-[#0b57d0] bg-white px-4 text-lg placeholder:text-[#8c9299] focus-visible:ring-2 focus-visible:ring-[#0b57d0]/15" />
            {errors.name && <p role="alert" className="mt-1.5 text-xs font-semibold text-[#b84d38]">{errors.name.message}</p>}
          </div>

          <div className="mt-7">
            <label htmlFor="party-phone" className="sr-only">মোবাইল নম্বর (ঐচ্ছিক)</label>
            <div className="flex gap-4">
              <div className="flex h-[72px] w-[140px] shrink-0 items-center justify-center gap-4 rounded-[5px] border border-[#d8dce1] bg-white text-[#4b535b]">
                <svg aria-label="বাংলাদেশের পতাকা" role="img" viewBox="0 0 30 20" className="h-5 w-[30px] overflow-hidden rounded-[2px]">
                  <rect width="30" height="20" fill="#006a4e" />
                  <circle cx="13.5" cy="10" r="5.4" fill="#f42a41" />
                </svg>
                <span className="text-base font-medium tracking-wide">+880</span>
              </div>
              <Input id="party-phone" {...register('phone')} inputMode="tel" autoComplete="tel-national" placeholder="মোবাইল নম্বর" data-testid="input-party-phone" className="h-[72px] min-w-0 flex-1 rounded-[5px] border border-[#d8dce1] bg-white px-4 text-lg placeholder:text-[#8c9299] focus-visible:border-[#0b57d0] focus-visible:ring-2 focus-visible:ring-[#0b57d0]/15" />
            </div>
            <p className="mt-2 text-xs text-[#89929a]">ঐচ্ছিক</p>
            {errors.phone && <p role="alert" className="mt-1.5 text-xs font-semibold text-[#b84d38]">{errors.phone.message}</p>}
          </div>

          <fieldset className="mt-6">
            <legend className="text-base font-medium text-[#535a61]">তারা কারা?</legend>
            <div role="radiogroup" aria-label="পার্টির ধরন" className="mt-3 flex items-center gap-7">
              {[
                { value: PartyRole.CUSTOMER, label: 'গ্রাহক' },
                { value: PartyRole.SUPPLIER, label: 'সাপ্লায়ার' },
              ].map((option) => (
                <label key={option.value} className="inline-flex cursor-pointer items-center gap-2.5 text-[15px] text-[#343a40]">
                  <input type="radio" name="party-role" value={option.value} className="peer sr-only" checked={currentRole === option.value} onChange={() => setValue('role', option.value, { shouldDirty: true, shouldValidate: true })} data-testid={`radio-party-role-${option.value.toLowerCase()}`} />
                  <span aria-hidden className={cn('grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition-colors', currentRole === option.value ? 'border-[#0b57d0]' : 'border-[#0b57d0]')}>
                    {currentRole === option.value && <span className="h-[11px] w-[11px] rounded-full bg-[#0b57d0]" />}
                  </span>
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="shrink-0 border-t border-[#eceff2] bg-white px-2.5 pb-[calc(1rem+var(--safe-bottom))] pt-3">
          <Button type="submit" disabled={!watch('name')?.trim() || createParty.isPending} data-testid="button-submit-party" className="h-[60px] w-full rounded-[5px] bg-[#0b57d0] text-base font-extrabold text-white shadow-[0_2px_4px_rgba(0,0,0,.16)] transition hover:bg-[#0b57d0]/90 active:scale-[.99] disabled:bg-[#9ab7d8]">
            {createParty.isPending ? 'যোগ করা হচ্ছে…' : isCustomer ? 'গ্রাহক যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}
          </Button>
        </div>
      </form>
    </>
  );
}
