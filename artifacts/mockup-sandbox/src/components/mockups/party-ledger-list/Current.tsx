import './_group.css';

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
      { id: 'current-1', dateTime: '8 Oct 26 • 04:10 PM', amount: 875, balance: 48924533, type: 'YOU_GOT' },
    ],
  },
  {
    date: '7 Oct 26',
    entries: [
      { id: 'current-2', dateTime: '7 Oct 26 • 07:27 PM', amount: 1111, balance: 48923658, type: 'YOU_GOT' },
      { id: 'current-3', dateTime: '7 Oct 26 • 07:27 PM', amount: 5888, balance: 48922547, type: 'YOU_GOT' },
      { id: 'current-4', dateTime: '7 Oct 26 • 06:54 PM', amount: 88855500, balance: -39362953, type: 'YOU_GAVE', transfer: 'ট্রান্সফার — hg' },
    ],
  },
  {
    date: '1 Aug 26 • 68 দিন আগে',
    entries: [
      { id: 'current-5', dateTime: '1 Aug 26 • 11:02 PM', amount: 1584, balance: 9565074.56, type: 'YOU_GOT' },
      { id: 'current-6', dateTime: '1 Aug 26 • 10:58 PM', amount: 9655, balance: 9563490.56, type: 'YOU_GOT' },
      { id: 'current-7', dateTime: '1 Aug 26 • 10:55 PM', amount: 1589765.59, balance: 1501710.59, type: 'YOU_GAVE', description: 'পণ্যের বিল, বিস্তারিত হিসাব' },
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

function amountFontSize(value: string) {
  const width = Array.from(value).reduce((sum, character) => {
    if (character === '৳') return sum + 0.9;
    if (character === ',' || character === '.') return sum + 0.35;
    return sum + 0.68;
  }, 0);
  return `${Math.min(14, 84 / (width * 1.12))}px`;
}

export function Current() {
  return (
    <main className="party-ledger-preview bg-[#F8FAFC]">
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_minmax(0,6rem)] gap-3 bg-[#F8FAFC] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <span>এন্ট্রি</span>
        <span className="w-24 min-w-0 text-center leading-tight">আপনি দিয়েছেন</span>
        <span className="w-24 min-w-0 text-right leading-tight">আপনি পেয়েছেন</span>
      </div>

      {groups.map((group) => (
        <section key={group.date}>
          <div className="sticky top-[26px] z-[4] flex justify-center bg-[#F8FAFC]/95 py-2 backdrop-blur-sm">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-400">
              {group.date}
            </span>
          </div>
          <div className="space-y-2 px-3">
            {group.entries.map((entry, index) => {
              const isDebit = entry.type === 'YOU_GAVE';
              const amount = formatCurrency(entry.amount);
              return (
                <div
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)_minmax(0,6rem)] items-center gap-3 overflow-hidden rounded-xl bg-white shadow-sm"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div className="min-w-0 py-3 pl-4">
                    <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-slate-700">
                      {entry.dateTime}
                      {entry.transfer && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-600">⇄ ট্রান্সফার</span>}
                    </p>
                    <p className={`mt-0.5 text-[11px] font-semibold ${entry.balance >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      ব্যালেন্স: <span className="inline-block max-w-full [overflow-wrap:anywhere]">{formatCurrency(entry.balance)}</span>
                    </p>
                    {entry.description && <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{entry.description}</p>}
                  </div>
                  <div className="flex h-full min-w-0 items-center justify-center bg-[#FFF5F5] px-1 py-3">
                    {isDebit && <span className="block w-full whitespace-nowrap text-center font-extrabold leading-tight text-red-700" style={{ fontSize: amountFontSize(amount) }}>{amount}</span>}
                  </div>
                  <div className="flex h-full min-w-0 items-center justify-end bg-white px-1 py-3">
                    {!isDebit && <span className="block w-full whitespace-nowrap text-right font-extrabold leading-tight text-emerald-600" style={{ fontSize: amountFontSize(amount) }}>{amount}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
