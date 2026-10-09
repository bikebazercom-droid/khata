import './_group.css';
import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Check, ChevronLeft, Contact as ContactIcon, Plus, Search, UserPlus, Users, X } from 'lucide-react';

type Role = 'CUSTOMER' | 'SUPPLIER';
type Contact = { id: string; name: string; phone: string };
const sampleContacts: Contact[] = [
  { id: '1', name: 'Abdul Karim Mia', phone: '01712 345 678' },
  { id: '2', name: 'Abubakar Friends & Brothers Trading', phone: '+880 1812 765 432' },
  { id: '3', name: 'Alamgir Hossain', phone: '01911 234 567' },
  { id: '4', name: 'Anika Fashion House', phone: '01622 345 901' },
  { id: '5', name: 'Bismillah General Store', phone: '01844 902 318' },
  { id: '6', name: 'Chowdhury Brothers Wholesale', phone: '01709 881 204' },
  { id: '7', name: 'Dhanmondi Stationery & Book Corner', phone: '01533 127 884' },
  { id: '8', name: 'Farzana Akter', phone: '01308 443 290' },
  { id: '9', name: 'Green Road Electric & Hardware', phone: '01972 008 661' },
  { id: '10', name: 'Hasan Traders', phone: '01819 552 640' },
  { id: '11', name: 'মোঃ রফিকুল ইসলাম', phone: '01715 660 421' },
  { id: '12', name: 'শাহানা বেগম', phone: '01671 342 890' },
];

function initials(name: string) {
  const chunks = name.trim().split(/\s+/).filter(Boolean);
  return chunks.length > 1 ? `${chunks[0][0]}${chunks[1][0]}`.toUpperCase() : (chunks[0]?.slice(0, 2) ?? '•').toUpperCase();
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

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('880')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits ? `+880${digits}` : '';
}

export function Redesigned() {
  const [screen, setScreen] = useState<'contacts' | 'form'>('contacts');
  const [contacts, setContacts] = useState<Contact[] | null>(sampleContacts);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [balance, setBalance] = useState('');
  const [balanceType, setBalanceType] = useState<'GET' | 'GIVE'>('GET');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [saved, setSaved] = useState('');

  const filtered = useMemo(() => (contacts ?? []).filter((contact) =>
    contact.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || contact.phone.includes(query)
  ), [contacts, query]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Contact[]>();
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

  const selectContact = (contact: Contact) => {
    setName(contact.name);
    setPhone(contact.phone);
    setScreen('form');
    setSaved('');
  };
  const openManual = () => {
    setName('');
    setPhone('');
    setScreen('form');
    setSaved('');
  };
  const importMockContacts = () => {
    setImporting(true);
    setImportMessage('');
    window.setTimeout(() => {
      setImporting(false);
      setContacts(null);
      setImportMessage('এই preview-তে ফোনের কন্টাক্ট খোলা যায় না। নাম দিয়ে ম্যানুয়ালি যোগ করুন।');
    }, 550);
  };
  const goToLetter = (letter: string) => document.getElementById(`redesigned-letter-${letter}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const reset = () => {
    setScreen('contacts');
    setContacts(sampleContacts);
    setQuery('');
    setImportMessage('');
  };

  return (
    <main className="min-h-[100dvh] bg-[#e9eef3] px-0 py-0 text-[#1c3049] sm:px-5 sm:py-6">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col overflow-hidden bg-[#fbfcfe] shadow-[0_12px_44px_rgba(31,57,83,.12)] sm:min-h-[820px] sm:rounded-[24px] sm:border sm:border-[#dce5ed]">
        {screen === 'contacts' ? (
          <>
            <header className="shrink-0 border-b border-[#e4eaf1] bg-white px-4 pb-4 pt-4">
              <div className="flex items-center gap-3">
                <button type="button" aria-label="বন্ধ করুন" onClick={reset} className="grid h-10 w-10 place-items-center rounded-full text-[#50657e] transition hover:bg-[#f1f5f9] active:scale-95"><ChevronLeft className="h-5 w-5" /></button>
                <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#7890a8]">BanglaKhata · খাতা</p><h1 className="text-lg font-extrabold text-[#17365b]">{role === 'CUSTOMER' ? 'কাস্টমার নির্বাচন করুন' : 'সাপ্লায়ার নির্বাচন করুন'}</h1></div>
                <span className="ml-auto grid h-10 w-10 place-items-center rounded-2xl bg-[#edf4fc] text-[#1758a8]"><Users className="h-5 w-5" /></span>
              </div>
            </header>
            <div className="z-10 shrink-0 border-b border-[#e5ebf2] px-4 pb-3 pt-4">
              <label className="relative block">
                <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8497aa]" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="কাস্টমার নাম / নম্বর খুঁজুন" aria-label="কন্টাক্ট খুঁজুন" className="h-12 w-full rounded-2xl border border-[#dfe7ef] bg-white pl-11 pr-11 text-[15px] outline-none transition focus:border-[#6e9bc7] focus:ring-4 focus:ring-[#3975b9]/10 placeholder:text-[#91a0af]" />
                {query && <button type="button" aria-label="খোঁজা মুছুন" onClick={() => setQuery('')} className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#8294a7] hover:bg-[#f0f4f8]"><X className="h-4 w-4" /></button>}
              </label>
              <button type="button" onClick={openManual} className="mt-3 flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left transition hover:bg-[#f1f6fb] active:scale-[.99]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-dashed border-[#8ca8c6] bg-white text-[#15549c]"><UserPlus className="h-[18px] w-[18px]" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-[#174879]">নতুন {role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'} ম্যানুয়ালি যোগ করুন</span><span className="mt-0.5 block text-xs text-[#8192a4]">শুধু নাম দিলেই খাতা তৈরি হবে</span></span>
                <ArrowRight className="mr-2 h-4 w-4 text-[#8298ae]" />
              </button>
              <button type="button" disabled={importing} onClick={importMockContacts} className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#d8e5f2] bg-[#eff6fc] text-sm font-bold text-[#215b96] transition hover:bg-[#e5f0fa] active:scale-[.99] disabled:opacity-60">
                {importing ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#9bb9d6] border-t-[#1758a8]" /> : <ContactIcon className="h-4 w-4" />}{importing ? 'কন্টাক্ট আনা হচ্ছে…' : 'ফোন কন্টাক্ট থেকে বেছে নিন'}
              </button>
              {importMessage && <div role="status" className="mt-2 flex items-start gap-2 rounded-xl bg-[#fff4ed] px-3 py-2.5 text-xs leading-5 text-[#8b4d22]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{importMessage}</span><button type="button" onClick={openManual} className="ml-auto shrink-0 font-bold text-[#1758a8] underline underline-offset-2">ম্যানুয়ালি যোগ</button></div>}
            </div>
            <section className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="কন্টাক্ট তালিকা">
              <div className="min-h-full px-4 pb-8">
                {contacts === null ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center px-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-[22px] bg-[#edf4fb] text-[#7391af]"><ContactIcon className="h-7 w-7" /></span><p className="mt-4 text-sm font-bold text-[#405a74]">কন্টাক্ট আমদানি করা হয়নি</p><p className="mt-1 max-w-xs text-xs leading-5 text-[#8b9aaa]">ফোনের কন্টাক্ট এই preview-তে পাওয়া যায় না। নাম দিয়ে ম্যানুয়ালি যোগ করুন।</p></div>
                ) : filtered.length === 0 ? (
                  <div className="flex min-h-[280px] flex-col items-center justify-center text-center"><span className="grid h-14 w-14 place-items-center rounded-full bg-[#f0f4f8] text-[#92a2b2]"><Search className="h-6 w-6" /></span><p className="mt-4 text-sm font-bold text-[#405a74]">এই নামে কোনো কন্টাক্ট নেই</p><p className="mt-1 text-xs text-[#8b9aaa]">অন্য নামে খুঁজুন অথবা ম্যানুয়ালি যোগ করুন।</p><button type="button" onClick={openManual} className="mt-4 rounded-xl bg-[#eaf2fa] px-4 py-2 text-sm font-bold text-[#1758a8]">ম্যানুয়ালি যোগ করুন</button></div>
                ) : (
                  <div className="pb-3 pr-6">{Array.from(grouped.entries()).map(([letter, entries]) => <div key={letter} id={`redesigned-letter-${letter}`} className="scroll-mt-2"><p className="sticky top-0 z-[1] bg-[#fbfcfe]/95 px-1 pb-1 pt-4 text-[11px] font-extrabold uppercase tracking-[.18em] text-[#8397aa] backdrop-blur">{letter}</p>{entries.map((contact) => <button key={contact.id} type="button" onClick={() => selectContact(contact)} className="group flex w-full items-center gap-3 border-b border-[#e9eef3] py-3 text-left transition-colors hover:bg-white active:bg-[#edf4fb]"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e7f0f9] text-sm font-extrabold text-[#285d91]">{initials(contact.name)}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-bold leading-5 text-[#263e57]">{contact.name}</span><span className="mt-0.5 block break-all text-xs leading-4 text-[#7c8d9f]">{contact.phone}</span></span><Plus className="mr-1 h-4 w-4 shrink-0 text-[#8da3b8] transition group-hover:text-[#1758a8]" /></button>)}</div>)}</div>
                )}
              </div>
              {contacts?.length ? <nav aria-label="নামের অক্ষর অনুযায়ী যান" className="absolute bottom-2 right-0 top-2 flex w-7 flex-col items-center justify-start gap-0.5 overflow-y-auto overscroll-contain py-2">{indexLetters.map((letter) => <button key={letter} type="button" onClick={() => goToLetter(letter)} aria-label={`${letter} অক্ষরের কন্টাক্ট`} className="min-h-5 w-6 rounded text-[10px] font-extrabold leading-5 text-[#1d5c9b] transition-colors hover:bg-[#e6eef7]">{letter}</button>)}</nav> : null}
            </section>
          </>
        ) : (
          <>
            <header className="shrink-0 bg-[#1558a5] px-4 pb-4 pt-4 text-white"><div className="flex items-center gap-3"><button type="button" onClick={() => setScreen('contacts')} aria-label="পিছনে যান" className="grid h-10 w-10 place-items-center rounded-full transition hover:bg-white/10"><ChevronLeft className="h-5 w-5" /></button><div><p className="text-[11px] font-bold uppercase tracking-[.16em] text-white/65">নতুন খাতা</p><h2 className="text-lg font-extrabold">{role === 'CUSTOMER' ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}</h2></div></div></header>
            {saved ? <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-full bg-[#eaf7f0] text-[#348264]"><Check className="h-7 w-7" /></span><h3 className="mt-4 text-lg font-extrabold text-[#24425f]">{saved} যোগ হয়েছে</h3><p className="mt-1 text-sm text-[#7b8c9d]">খাতায় নতুন নাম যোগ করা হয়েছে।</p><button type="button" onClick={reset} className="mt-6 h-12 rounded-xl bg-[#1558a5] px-6 text-sm font-extrabold text-white">কন্টাক্ট তালিকায় ফিরুন</button></div> : (
              <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) { if (phone.trim()) normalizePhone(phone); setSaved(role === 'CUSTOMER' ? 'কাস্টমার' : 'সাপ্লায়ার'); } }} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
                  <div><label className="mb-2 block text-sm font-bold text-[#344c65]">{role === 'CUSTOMER' ? 'কাস্টমারের নাম' : 'সাপ্লায়ারের নাম'} <span className="text-[#b84d38]">*</span></label><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="যেমন: রহিম স্টোর" className="h-[54px] w-full rounded-xl border border-[#d9e2eb] bg-white px-4 text-base outline-none placeholder:text-[#98a5b2] focus:border-[#6e9bc7] focus:ring-4 focus:ring-[#3975b9]/10" /><p className="mt-2 text-xs text-[#8191a1]">নামই যথেষ্ট—ফোন নম্বর পরে যোগ করতে পারবেন।</p></div>
                  <div><label className="mb-2 block text-sm font-bold text-[#344c65]">মোবাইল নম্বর <span className="font-normal text-[#8b99a7]">(ঐচ্ছিক)</span></label><div className="flex gap-2"><div className="flex h-[52px] shrink-0 items-center gap-2 rounded-xl border border-[#dce4ec] bg-[#f3f6f9] px-3.5 text-[#455d74]"><svg aria-label="বাংলাদেশের পতাকা" role="img" viewBox="0 0 30 20" className="h-4 w-6 overflow-hidden rounded-[2px] shadow-sm"><rect width="30" height="20" fill="#006a4e" /><circle cx="13.5" cy="10" r="5.4" fill="#f42a41" /></svg><span className="text-sm font-extrabold tracking-wide">BD +880</span></div><input inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="01XXXXXXXXX" className="h-[52px] min-w-0 flex-1 rounded-xl border border-[#d9e2eb] bg-white px-4 text-base tracking-wide outline-none placeholder:text-[#9aa8b6] focus:border-[#6e9bc7] focus:ring-4 focus:ring-[#3975b9]/10" /></div></div>
                  <div><label className="mb-2 block text-sm font-bold text-[#344c65]">তারা কে?</label><div className="grid grid-cols-2 gap-1 rounded-xl bg-[#edf1f5] p-1">{([{ value: 'CUSTOMER', label: 'কাস্টমার' }, { value: 'SUPPLIER', label: 'সাপ্লায়ার' }] as const).map((option) => <button key={option.value} type="button" onClick={() => setRole(option.value)} className={`min-h-11 rounded-lg text-sm font-bold transition-all ${role === option.value ? 'bg-white text-[#1758a8] shadow-[0_1px_4px_rgba(24,49,74,.12)]' : 'text-[#778797]'}`}>{option.label}</button>)}</div></div>
                  <div className="border-t border-[#e5eaf0] pt-5"><label className="mb-2 block text-sm font-bold text-[#344c65]">শুরুর ব্যালেন্স <span className="font-normal text-[#8b99a7]">(ঐচ্ছিক)</span></label><div className="flex gap-2.5"><div className="relative min-w-0 flex-1"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-[#8292a1]">৳</span><input type="number" min="0" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="0" className="h-[52px] w-full rounded-xl border border-[#d9e2eb] bg-white pl-10 text-base font-semibold outline-none focus:border-[#6e9bc7]" /></div><select aria-label="ব্যালেন্সের ধরন" value={balanceType} onChange={(event) => setBalanceType(event.target.value as 'GET' | 'GIVE')} className={`h-[52px] min-w-[112px] flex-1 rounded-xl border px-3 text-sm font-bold outline-none ${balanceType === 'GET' ? 'border-[#cde8dc] bg-[#f0faf5] text-[#287655]' : 'border-[#f0d7ce] bg-[#fff5f1] text-[#a4543a]'}`}><option value="GET">পাবেন</option><option value="GIVE">দেবেন</option></select></div></div>
                </div>
                <div className="shrink-0 border-t border-[#e4eaf0] bg-white px-5 pb-5 pt-3"><button type="submit" disabled={!name.trim()} className="h-[54px] w-full rounded-xl bg-[#1558a5] text-base font-extrabold text-white shadow-[0_5px_14px_rgba(21,88,165,.2)] transition hover:bg-[#104a8c] active:scale-[.99] disabled:bg-[#9ab7d8]">{role === 'CUSTOMER' ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}</button></div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
