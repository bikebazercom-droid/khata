import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateParty, PartyRole, BalanceType, getListPartiesQueryKey, getGetDashboardSummaryQueryKey } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ChevronLeft, Search, X, UserPlus, Contact as ContactIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// The Contact Picker API (navigator.contacts.select) is not yet part of the
// standard DOM typings; declare just enough of the shape we use.
type PickedContact = { name?: string[]; tel?: string[] };
type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<PickedContact[]> };

function getContactsManager(): ContactsManager | null {
  const nav = navigator as Navigator & { contacts?: ContactsManager };
  return typeof window !== 'undefined' && 'contacts' in navigator && nav.contacts ? nav.contacts : null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

type DirectoryContact = { id: string; name: string; phone: string };

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '+';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const formSchema = z.object({
  name: z.string().min(1, 'নাম আবশ্যক'),
  phone: z.string().optional(),
  role: z.nativeEnum(PartyRole),
  openingBalance: z.coerce.number().optional(),
  openingBalanceType: z.nativeEnum(BalanceType).optional(),
});

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
  const [prefill, setPrefill] = useState<{ name: string; phone: string } | undefined>(undefined);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 bg-white flex flex-col">
      {step === 'contacts' ? (
        <ContactDirectoryScreen
          role={defaultRole}
          onClose={() => onOpenChange(false)}
          onManualAdd={() => {
            setPrefill(undefined);
            setStep('form');
          }}
          onPickContact={(contact) => {
            setPrefill(contact);
            setStep('form');
          }}
        />
      ) : (
        <AddPartyForm
          defaultRole={defaultRole}
          prefill={prefill}
          onBack={() => setStep('contacts')}
          onDone={() => {
            setStep('contacts');
            onOpenChange(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 2: contact directory selector
// ---------------------------------------------------------------------------

function ContactDirectoryScreen({
  role,
  onClose,
  onManualAdd,
  onPickContact,
}: {
  role: PartyRole;
  onClose: () => void;
  onManualAdd: () => void;
  onPickContact: (contact: { name: string; phone: string }) => void;
}) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<DirectoryContact[] | null>(null);
  const [importing, setImporting] = useState(false);
  const contactsSupported = useMemo(() => getContactsManager() !== null, []);

  const filtered = (contacts || []).filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));

  const grouped = useMemo(() => {
    const map = new Map<string, DirectoryContact[]>();
    for (const c of filtered) {
      const letter = /[A-Za-z]/.test(c.name.charAt(0)) ? c.name.charAt(0).toUpperCase() : '#';
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return map;
  }, [filtered]);

  const handleImportContacts = async () => {
    const manager = getContactsManager();
    if (!manager) return;
    setImporting(true);
    try {
      const picked = await manager.select(['name', 'tel'], { multiple: true });
      const mapped: DirectoryContact[] = picked
        .map((p, i) => ({
          id: `${i}-${p.tel?.[0] ?? p.name?.[0] ?? i}`,
          name: p.name?.[0] || 'নাম নেই',
          phone: p.tel?.[0] || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(mapped);
      if (mapped.length === 0) {
        toast('কোনো কন্টাক্ট নির্বাচন করা হয়নি');
      }
    } catch {
      // User cancelled the native picker, or permission was denied — no-op.
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 pb-3 pt-[calc(0.75rem+var(--safe-top))] border-b border-slate-100">
        <button
          type="button"
          onClick={onClose}
          aria-label="বন্ধ করুন"
          className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 active:scale-95 transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="font-extrabold text-[15px] text-slate-800">
          {role === PartyRole.CUSTOMER ? 'কাস্টমার নির্বাচন করুন' : 'সাপ্লায়ার নির্বাচন করুন'}
        </h2>
      </div>

      {/* Sticky search + manual-add + import */}
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-2 border-b border-slate-100">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={role === PartyRole.CUSTOMER ? 'কাস্টমার নাম / নম্বর খুঁজুন' : 'সাপ্লায়ার নাম / নম্বর খুঁজুন'}
            className="pl-10 pr-9 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-primary/20"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="মুছে ফেলুন"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 active:scale-90 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onManualAdd}
          className="w-full flex items-center gap-3 py-2.5 text-primary active:opacity-70 transition-opacity"
        >
          <span className="w-9 h-9 rounded-full border-2 border-dashed border-primary/50 flex items-center justify-center shrink-0">
            <UserPlus className="w-4 h-4" />
          </span>
          <span className="text-sm font-bold">
            + নতুন {role === PartyRole.CUSTOMER ? 'কাস্টমার' : 'সাপ্লায়ার'} ম্যানুয়ালি যোগ করুন
          </span>
        </button>

        {contactsSupported ? (
          <button
            type="button"
            onClick={handleImportContacts}
            disabled={importing}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-blue-50 text-primary text-sm font-bold active:scale-[0.98] transition-all disabled:opacity-60"
          >
            <ContactIcon className="w-4 h-4" />
            {importing ? 'কন্টাক্ট আনা হচ্ছে…' : 'ফোন কন্টাক্ট থেকে বেছে নিন'}
          </button>
        ) : (
          <p className="text-xs font-medium text-slate-400 px-1">
            এই ব্রাউজারে ফোন কন্টাক্ট আমদানি সমর্থিত নয় — উপরে ম্যানুয়ালি যোগ করুন।
          </p>
        )}
      </div>

      {/* Content scroll feed */}
      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {contacts === null ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-8 text-center">
            <ContactIcon className="w-10 h-10 opacity-30 mb-3" />
            <p className="text-sm font-medium">এখনো কোনো কন্টাক্ট আমদানি করা হয়নি</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-8 text-center">
            <p className="text-sm font-medium">কোনো ফলাফল পাওয়া যায়নি</p>
          </div>
        ) : (
          <div className="pr-8">
            {Array.from(grouped.entries()).map(([letter, items]) => (
              <div key={letter} id={`letter-${letter}`}>
                <p className="px-4 pt-3 pb-1 text-[11px] font-extrabold text-slate-400 uppercase tracking-widest">{letter}</p>
                {items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onPickContact({ name: c.name, phone: c.phone })}
                    className="w-full flex items-center gap-3 px-4 py-2.5 active:bg-slate-50 transition-colors text-left"
                  >
                    <div className="w-11 h-11 rounded-full bg-blue-50 text-primary font-bold flex items-center justify-center shrink-0 text-sm">
                      {initialsOf(c.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{c.name}</p>
                      {c.phone && <p className="text-xs font-medium text-slate-500 truncate">{c.phone}</p>}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* A-Z shortcut rail */}
        {contacts !== null && contacts.length > 0 && (
          <div className="absolute right-0 top-0 bottom-0 w-6 flex flex-col items-center justify-center py-2">
            {ALPHABET.map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => document.getElementById(`letter-${letter}`)?.scrollIntoView({ block: 'start' })}
                className={cn(
                  'text-[9px] font-bold leading-[1.15] w-5 text-center transition-colors',
                  grouped.has(letter) ? 'text-primary' : 'text-slate-300'
                )}
              >
                {letter}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen 1: add party form
// ---------------------------------------------------------------------------

function AddPartyForm({
  defaultRole,
  prefill,
  onBack,
  onDone,
}: {
  defaultRole: PartyRole;
  prefill?: { name: string; phone: string };
  onBack: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const createParty = useCreateParty();

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: prefill?.name || '',
      phone: (prefill?.phone || '').replace(/^\+?880/, '').trim(),
      role: defaultRole,
      openingBalance: 0,
      openingBalanceType: BalanceType.YOU_WILL_GET,
    },
  });

  const balanceType = watch('openingBalanceType');
  const currentRole = watch('role');
  const isCustomer = currentRole === PartyRole.CUSTOMER;

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const phone = data.phone?.trim();
    createParty.mutate(
      {
        data: {
          ...data,
          // Mobile number is entirely optional — store "" rather than
          // failing when the shop owner only has a name to go on.
          phone: phone ? `+880${phone}` : '',
          openingBalance: data.openingBalance || undefined,
          openingBalanceType: data.openingBalance ? data.openingBalanceType : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(isCustomer ? 'কাস্টমার সফলভাবে যোগ করা হয়েছে' : 'সাপ্লায়ার সফলভাবে যোগ করা হয়েছে');
          queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          onDone();
        },
        onError: () => {
          toast.error('যুক্ত করা যায়নি');
        },
      }
    );
  };

  return (
    <>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 pb-3 pt-[calc(0.75rem+var(--safe-top))] bg-[#0b57d0]">
        <button
          type="button"
          onClick={onBack}
          aria-label="পিছনে যান"
          className="w-9 h-9 rounded-full flex items-center justify-center text-white active:scale-95 transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="font-extrabold text-[15px] text-white">
          {isCustomer ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}
        </h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-5">
          <div>
            <label className="text-sm font-semibold mb-1.5 block text-slate-700">
              {isCustomer ? 'কাস্টমারের নাম' : 'সাপ্লায়ারের নাম'}
            </label>
            <Input
              {...register('name')}
              autoFocus
              placeholder={isCustomer ? 'কাস্টমারের নাম' : 'সাপ্লায়ারের নাম'}
              className="bg-slate-50 border-slate-200 focus-visible:ring-primary/30 h-12"
            />
            {errors.name && <p className="text-red-500 text-xs mt-1 font-medium">{errors.name.message}</p>}
          </div>

          <div>
            <label className="text-sm font-semibold mb-1.5 block text-slate-700">
              মোবাইল নাম্বার <span className="text-slate-400 font-normal">(ঐচ্ছিক)</span>
            </label>
            <div className="flex gap-2">
              <div className="h-12 px-3 rounded-md border border-slate-200 bg-slate-100 flex items-center gap-1.5 font-bold text-slate-600 shrink-0">
                <span aria-hidden>🇧🇩</span>
                <span>+৮৮০</span>
              </div>
              <Input
                {...register('phone')}
                inputMode="tel"
                placeholder="মোবাইল নাম্বার"
                className="flex-1 bg-slate-50 border-slate-200 focus-visible:ring-primary/30 h-12"
              />
            </div>
            {errors.phone && <p className="text-red-500 text-xs mt-1 font-medium">{errors.phone.message}</p>}
          </div>

          <div>
            <label className="text-sm font-semibold mb-2 block text-slate-700">তারা কে?</label>
            <div role="radiogroup" className="flex gap-2 p-1 bg-slate-100 rounded-lg">
              {[
                { value: PartyRole.CUSTOMER, label: 'কাস্টমার' },
                { value: PartyRole.SUPPLIER, label: 'সাপ্লায়ার' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex-1 py-2.5 text-sm font-semibold rounded-md transition-all text-center cursor-pointer flex items-center justify-center gap-1.5',
                    currentRole === opt.value ? 'bg-white shadow-sm text-primary' : 'text-slate-500'
                  )}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={currentRole === opt.value}
                    onChange={() => setValue('role', opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className="text-sm font-semibold mb-2 block text-slate-700">শুরুর ব্যালেন্স (ঐচ্ছিক)</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">৳</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  {...register('openingBalance')}
                  placeholder="0"
                  className="pl-8 bg-slate-50 border-slate-200 focus-visible:ring-primary/30 font-semibold h-12"
                />
              </div>
              <select
                {...register('openingBalanceType')}
                className={cn(
                  'flex-1 rounded-md border text-sm px-3 font-semibold outline-none focus:ring-2 focus:ring-primary/20 transition-colors',
                  balanceType === BalanceType.YOU_WILL_GET
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-red-50 text-red-700 border-red-200'
                )}
              >
                <option value={BalanceType.YOU_WILL_GET}>পাবেন</option>
                <option value={BalanceType.YOU_WILL_GIVE}>দেবেন</option>
              </select>
            </div>
          </div>
        </div>

        {/* Sticky bottom action */}
        <div className="shrink-0 px-4 pt-3 pb-[calc(1rem+var(--safe-bottom))] border-t border-slate-100">
          <Button
            type="submit"
            disabled={createParty.isPending}
            className="w-full h-14 rounded-xl font-extrabold text-white text-base bg-[#0b57d0] hover:bg-[#0b57d0]/90 shadow-[0_4px_14px_0_rgba(11,87,208,0.35)] active:scale-[0.98] transition-all"
          >
            {isCustomer ? 'ADD CUSTOMER' : 'ADD SUPPLIER'}
          </Button>
        </div>
      </form>
    </>
  );
}
