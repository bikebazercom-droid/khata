import './_group.css';
import { useEffect, useState } from 'react';

type LedgerSample = {
  id: string;
  dateTime: string;
  amount: number;
  balance: number;
  type: 'YOU_GAVE' | 'YOU_GOT';
  description?: string;
  transfer?: string;
};

const groups: { date: string; entries: LedgerSample[] }[] = [
  {
    date: '8 Oct 26 • আজ',
    entries: [
      { id: 'carded-1', dateTime: '8 Oct 26 • 04:10 PM', amount: 875, balance: 48924533, type: 'YOU_GOT' },
    ],
  },
  {
    date: '7 Oct 26 • ১ দিন আগে',
    entries: [
      { id: 'carded-2', dateTime: '7 Oct 26 • 07:27 PM', amount: 1111, balance: 48923658, type: 'YOU_GOT' },
      { id: 'carded-3', dateTime: '7 Oct 26 • 07:27 PM', amount: 5888, balance: 48922547, type: 'YOU_GOT' },
      { id: 'carded-4', dateTime: '7 Oct 26 • 06:54 PM', amount: 88855500, balance: -39362953, type: 'YOU_GAVE', transfer: 'ট্রান্সফার — hg' },
    ],
  },
  {
    date: '1 Aug 26 • ৬৮ দিন আগে',
    entries: [
      { id: 'carded-5', dateTime: '1 Aug 26 • 11:02 PM', amount: 1584, balance: 9565074.56, type: 'YOU_GOT' },
      { id: 'carded-6', dateTime: '1 Aug 26 • 10:58 PM', amount: 9655, balance: 9563490.56, type: 'YOU_GOT' },
      { id: 'carded-7', dateTime: '1 Aug 26 • 10:55 PM', amount: 1589765.59, balance: 1501710.59, type: 'YOU_GAVE', description: 'পণ্যের বিল, বিস্তারিত হিসাব' },
    ],
  },
];

function formatCurrency(amount: number) {
  const hasDecimal = !Number.isInteger(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return `৳${formatted.replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)])}`;
}

function amountColumnWidth(viewportWidth: number) {
  if (viewportWidth < 380) return 80;
  if (viewportWidth < 480) return 88;
  return 96;
}

function amountFontSize(value: string, columnWidth: number) {
  const width = Array.from(value).reduce((sum, character) => {
    if (character === '৳') return sum + 0.9;
    if (character === ',' || character === '.') return sum + 0.35;
    return sum + 0.68;
  }, 0);
  const maxFontSize = columnWidth < 80 ? 11 : columnWidth < 96 ? 12 : 14;
  return `${Math.min(maxFontSize, (columnWidth - 8) / (width * 1.12))}px`;
}

function balanceFontSize(value: string, availableWidth: number) {
  const width = Array.from(value).reduce((sum, character) => {
    if (character === '৳') return sum + 0.9;
    if (character === ',' || character === '.') return sum + 0.35;
    if (/[0-9০-৯]/.test(character)) return sum + 0.68;
    if (/\s/.test(character)) return sum + 0.3;
    return sum + 0.55;
  }, 0);
  return `${Math.min(10, availableWidth / (width * 1.12))}px`;
}

export function Carded() {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);
  const amountWidth = amountColumnWidth(viewportWidth);

  return (
    <main className="party-ledger-preview min-h-screen bg-[#F5F6F8] pb-8">
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_5rem_5rem] min-[380px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] min-[480px]:grid-cols-[minmax(0,1fr)_6rem_6rem] bg-[#F5F6F8] px-1.5 py-2 text-[8px] font-bold uppercase tracking-wider text-slate-500 min-[480px]:px-3 min-[480px]:text-[10px]">
        <span>এন্ট্রি</span>
        <span className="px-1 text-center leading-tight">আপনি দিয়েছেন</span>
        <span className="px-1 text-right leading-tight">আপনি পেয়েছেন</span>
      </div>

      {groups.map((group) => (
        <section key={group.date}>
          <div className="sticky top-[26px] z-[4] flex justify-center bg-[#F5F6F8]/95 py-2 backdrop-blur-sm">
            <span className="text-[11px] font-semibold tracking-wide text-slate-500">{group.date}</span>
          </div>
          <div className="space-y-2 px-1.5 min-[480px]:px-2.5">
            {group.entries.map((entry) => {
              const isDebit = entry.type === 'YOU_GAVE';
              const amount = formatCurrency(entry.amount);
              const balance = formatCurrency(entry.balance);
              const balanceWidth = Math.max(40, viewportWidth - 38 - (2 * amountWidth));
              return (
                <article
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] min-[380px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] min-[480px]:grid-cols-[minmax(0,1fr)_6rem_6rem] items-stretch overflow-hidden rounded-xl border border-[#EBEBEB] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.07)]"
                >
                  <div className="min-w-0 py-2.5 pl-2 pr-1 min-[480px]:py-3 min-[480px]:pl-3 min-[480px]:pr-2">
                    <p className="flex flex-wrap items-center gap-1 text-[10px] font-bold leading-snug text-slate-800 min-[480px]:text-[12px]">
                      {entry.dateTime}
                      {entry.transfer && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600">⇄ ট্রান্সফার</span>}
                    </p>
                    <span
                      className={`mt-1 inline-flex max-w-full flex-nowrap items-center whitespace-nowrap rounded-md px-1 py-0.5 text-[8px] font-semibold leading-snug min-[380px]:text-[9px] min-[480px]:px-1.5 min-[480px]:text-[10px] ${entry.balance >= 0 ? 'bg-[#EAF4F1] text-emerald-800' : 'bg-[#FFF0F0] text-red-700'}`}
                      style={{ fontSize: balanceFontSize(`ব্যালেন্স: ${balance}`, balanceWidth) }}
                    >
                      <span className="shrink-0">ব্যালেন্স:</span>
                      <span className="ml-1 min-w-0 whitespace-nowrap">{balance}</span>
                    </span>
                    {entry.description && <p className="mt-1 truncate text-[10px] font-medium text-slate-500">{entry.description}</p>}
                  </div>
                  <div className={`flex min-w-0 items-center justify-end px-0.5 py-2.5 min-[480px]:px-1 min-[480px]:py-3 ${isDebit ? 'bg-[#FFF5F5]' : 'bg-white'}`}>
                    {isDebit && <span className="block w-full whitespace-nowrap text-right font-extrabold leading-tight text-red-700" style={{ fontSize: amountFontSize(amount, amountWidth) }}>{amount}</span>}
                  </div>
                  <div className={`flex min-w-0 items-center justify-end px-0.5 py-2.5 min-[480px]:px-1 min-[480px]:py-3 ${!isDebit ? 'bg-[#F0F8F5]' : 'bg-white'}`}>
                    {!isDebit && <span className="block w-full whitespace-nowrap text-right font-extrabold leading-tight text-emerald-700" style={{ fontSize: amountFontSize(amount, amountWidth) }}>{amount}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
