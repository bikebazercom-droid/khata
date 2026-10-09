import './_group.css';
import { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Contact as ContactIcon, Plus, Search, X } from 'lucide-react';

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
  { id: '11', name: '+880 1324 740 609', phone: '+880 1324 740 609' },
  { id: '12', name: 'মোঃ রফিকুল ইসলাম', phone: '01715 660 421' },
  { id: '13', name: 'শাহানা বেগম', phone: '01671 342 890' },
];

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function initials(name: string) {
  const chunks = name.trim().split(/\s+/).filter(Boolean);
  const nameDigits = name.replace(/\D/g, '');
  if (nameDigits.length >= 7) return '';
  if (chunks.length > 1) return `${chunks[0][0]}${chunks[1][0]}`.toUpperCase();
  return chunks[0]?.slice(0, 2).toUpperCase() ?? '';
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

function isPhoneOnly(contact: Contact) {
  const nameDigits = contact.name.replace(/\D/g, '');
  const phoneDigits = contact.phone.replace(/\D/g, '');
  return nameDigits.length >= 7 && (!phoneDigits || nameDigits === phoneDigits);
}

export function Redesigned() {
  const [screen, setScreen] = useState<'contacts' | 'form'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('screen') === 'form' ? 'form' : 'contacts'
  );
  const [contacts] = useState<Contact[]>(sampleContacts);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);

  const filtered = useMemo(() => contacts.filter((contact) =>
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
  const visibleIndex = [...alphabet, ...(grouped.has('#') ? ['#'] : []), ...[...grouped.keys()].filter((letter) => !/^[A-Z]$/.test(letter) && letter !== '#')];

  const openForm = (contact?: Contact) => {
    setName(contact?.name ?? '');
    setPhone(contact?.phone ?? '');
    setSaved(false);
    setScreen('form');
  };
  const backToContacts = () => {
    setScreen('contacts');
    setQuery('');
  };
  const goToLetter = (letter: string) => {
    document.getElementById(`redesigned-letter-${letter}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const roleName = role === 'CUSTOMER' ? 'গ্রাহক' : 'সাপ্লায়ার';

  return (
    <main className="min-h-[100dvh] bg-white text-[#202b37]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col overflow-hidden bg-white sm:min-h-[820px] sm:border-x sm:border-[#e2e6ea]">
        {screen === 'contacts' ? (
          <>
            <header className="h-[88px] shrink-0 bg-[#0b57d0] text-white">
              <div className="flex h-full items-end gap-3 px-4 pb-3">
                <button type="button" aria-label="পিছনে যান" className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:bg-white/10 active:scale-95"><ChevronLeft className="h-6 w-6" /></button>
                <h1 className="pb-2 text-lg font-extrabold">{roleName} নির্বাচন করুন</h1>
              </div>
            </header>
            <div className="z-10 shrink-0 bg-white px-5 pb-2 pt-4">
              <div className="flex items-center gap-2">
                <label className="relative block min-w-0 flex-1">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={role === 'CUSTOMER' ? 'গ্রাহকের নাম' : 'সাপ্লায়ারের নাম'} aria-label="কন্টাক্ট খুঁজুন" className="h-[54px] w-full rounded-[14px] border border-[#d8dce1] bg-white pl-4 pr-12 text-base outline-none placeholder:text-[#8b9198] focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/15" />
                  <Search className="pointer-events-none absolute right-4 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-[#17202a]" />
                  {query && <button type="button" onClick={() => setQuery('')} aria-label="খোঁজা মুছুন" className="absolute right-11 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-[#8294a7] hover:bg-[#f0f4f8]"><X className="h-4 w-4" /></button>}
                </label>
                <button type="button" aria-label="ফোনের কন্টাক্ট থেকে বেছে নিন" title="ফোনের কন্টাক্ট থেকে বেছে নিন" className="grid h-[54px] w-[48px] shrink-0 place-items-center rounded-[12px] border border-[#d8dce1] bg-white text-[#0b57d0] transition hover:bg-[#f5f8fc] active:scale-95"><ContactIcon className="h-5 w-5" /></button>
              </div>
              <button type="button" onClick={() => openForm()} className="mt-4 flex min-h-[64px] w-full items-center gap-4 rounded-xl px-1 text-left text-[#0b4d8f] transition hover:bg-[#f5f8fc] active:scale-[.99]">
                <span className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full border-2 border-dashed border-[#8ea9c2] bg-white text-[#0b57d0]"><Plus className="h-7 w-7" /></span>
                <span className="min-w-0 flex-1 text-base font-bold">{roleName} যুক্ত করুন</span>
                <ArrowRight className="mr-2 h-5 w-5 shrink-0 text-[#0b4d8f]" />
              </button>
            </div>
            <section className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="কন্টাক্ট তালিকা">
              <div className="min-h-full px-3 pb-8">
                {filtered.length === 0 ? (
                  <div className="flex min-h-[240px] flex-col items-center justify-center px-8 text-center"><Search className="h-7 w-7 text-[#aab4bf]" /><p className="mt-3 text-sm font-medium text-[#7f8993]">এই নামে কোনো কন্টাক্ট নেই</p></div>
                ) : (
                  <div className="pb-3 pr-7">{Array.from(grouped.entries()).map(([letter, entries]) => (
                    <div key={letter} id={`redesigned-letter-${letter}`} className="scroll-mt-2">
                      <p className="sticky top-0 z-[1] bg-white/95 px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#a0a8b1] backdrop-blur">{letter}</p>
                      {entries.map((contact) => (
                        <button key={contact.id} type="button" onClick={() => openForm(contact)} className="flex min-h-[94px] w-full items-center gap-4 border-b border-[#eef0f2] px-2 py-3 text-left transition-colors hover:bg-[#f9fbfd] active:bg-[#f1f5f9]">
                          <span className="grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full bg-[#0b4d8f] text-[18px] font-medium text-white">{isPhoneOnly(contact) ? <Plus className="h-7 w-7" /> : initials(contact.name)}</span>
                          <span className="min-w-0 flex-1"><span className="block break-words text-[16px] font-medium leading-6 text-[#191f25]">{contact.name}</span><span className="mt-1 block whitespace-nowrap text-sm leading-5 text-[#9aa0a6]">{contact.phone}</span></span>
                        </button>
                      ))}
                    </div>
                  ))}</div>
                )}
              </div>
              {contacts.length > 0 && <nav aria-label="নামের অক্ষর অনুযায়ী যান" className="absolute bottom-1 right-0 top-1 flex w-6 flex-col items-center justify-between overflow-y-auto overscroll-contain py-2">{visibleIndex.map((letter) => <button key={letter} type="button" onClick={() => grouped.has(letter) && goToLetter(letter)} disabled={!grouped.has(letter)} aria-label={`${letter} অক্ষরের কন্টাক্ট`} className={`grid min-h-[18px] w-5 flex-1 place-items-center rounded text-[9px] font-medium leading-none transition-colors ${grouped.has(letter) ? 'text-[#53606d] hover:bg-[#e9f0f7]' : 'text-[#aeb5bc]'}`}>{letter}</button>)}</nav>}
            </section>
          </>
        ) : (
          <>
            <header className="h-[88px] shrink-0 bg-[#0b57d0] text-white">
              <div className="flex h-full items-end gap-3 px-4 pb-3">
                <button type="button" onClick={backToContacts} aria-label="পিছনে যান" className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:bg-white/10 active:scale-95"><ChevronLeft className="h-6 w-6" /></button>
                <h2 className="pb-2 text-lg font-extrabold">পার্টি যুক্ত করুন</h2>
              </div>
            </header>
            {saved ? (
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-full bg-[#eaf7f0] text-[#348264]"><Check className="h-7 w-7" /></span><h3 className="mt-4 text-lg font-extrabold text-[#24425f]">{roleName} যোগ হয়েছে</h3><button type="button" onClick={backToContacts} className="mt-6 h-12 rounded-xl bg-[#0b57d0] px-6 text-sm font-extrabold text-white">কন্টাক্ট তালিকায় ফিরুন</button></div>
            ) : (
              <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) setSaved(true); }} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-6">
                  <div><label htmlFor="preview-party-name" className="sr-only">পার্টির নাম</label><input id="preview-party-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="পার্টির নাম" className="h-[72px] w-full rounded-[5px] border-2 border-[#0b57d0] bg-white px-4 text-lg outline-none placeholder:text-[#8c9299] focus:ring-2 focus:ring-[#0b57d0]/15" /></div>
                  <div className="mt-7">
                    <label htmlFor="preview-party-phone" className="sr-only">মোবাইল নম্বর (ঐচ্ছিক)</label>
                    <div className="flex gap-4">
                      <div className="flex h-[72px] w-[140px] shrink-0 items-center justify-center gap-4 rounded-[5px] border border-[#d8dce1] bg-white text-[#4b535b]"><svg aria-label="বাংলাদেশের পতাকা" role="img" viewBox="0 0 30 20" className="h-5 w-[30px] overflow-hidden rounded-[2px]"><rect width="30" height="20" fill="#006a4e" /><circle cx="13.5" cy="10" r="5.4" fill="#f42a41" /></svg><span className="text-base font-medium tracking-wide">+880</span></div>
                      <input id="preview-party-phone" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="মোবাইল নম্বর" className="h-[72px] min-w-0 flex-1 rounded-[5px] border border-[#d8dce1] bg-white px-4 text-lg outline-none placeholder:text-[#8c9299] focus:border-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/15" />
                    </div>
                    <p className="mt-2 text-xs text-[#89929a]">ঐচ্ছিক</p>
                  </div>
                  <fieldset className="mt-6">
                    <legend className="text-base font-medium text-[#535a61]">তারা কারা?</legend>
                    <div role="radiogroup" aria-label="পার্টির ধরন" className="mt-3 flex items-center gap-7">{([{ value: 'CUSTOMER', label: 'গ্রাহক' }, { value: 'SUPPLIER', label: 'সাপ্লায়ার' }] as const).map((option) => <label key={option.value} className="inline-flex cursor-pointer items-center gap-2.5 text-[15px] text-[#343a40]"><input type="radio" name="party-role" checked={role === option.value} onChange={() => setRole(option.value)} className="sr-only" /><span aria-hidden className={`grid h-[22px] w-[22px] place-items-center rounded-full border-2 ${role === option.value ? 'border-[#0b57d0]' : 'border-[#8d9ba9]'}`}>{role === option.value && <span className="h-[11px] w-[11px] rounded-full bg-[#0b57d0]" />}</span>{option.label}</label>)}</div>
                  </fieldset>
                </div>
                <div className="shrink-0 border-t border-[#eceff2] bg-white px-2.5 pb-4 pt-3"><button type="submit" disabled={!name.trim()} className="h-[60px] w-full rounded-[5px] bg-[#0b57d0] text-base font-extrabold text-white shadow-[0_2px_4px_rgba(0,0,0,.16)] transition hover:bg-[#0b57d0]/90 active:scale-[.99] disabled:bg-[#9ab7d8]">{role === 'CUSTOMER' ? 'গ্রাহক যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}</button></div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
