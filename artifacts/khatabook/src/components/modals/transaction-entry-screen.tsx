import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateLedgerEntry,
  LedgerEntryType,
  getListLedgerEntriesQueryKey,
  getGetPartyQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
} from '@workspace/api-client-react';
import { ChevronLeft, Camera, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn, evaluateCalculatorExpression, formatCurrency, formatExpressionForDisplay, trimNumberForExpression } from '@/lib/utils';

type KeyKind = 'digit' | 'muted' | 'accent';
type KeyDef = { label: string; value: string; kind: KeyKind; span?: number };

const ROW_MEMORY: KeyDef[] = [
  { label: 'C', value: 'C', kind: 'muted' },
  { label: 'M+', value: 'M+', kind: 'muted' },
  { label: 'M-', value: 'M-', kind: 'muted' },
  { label: '⌫', value: 'DEL', kind: 'digit' },
];
const ROW_789: KeyDef[] = [
  { label: '7', value: '7', kind: 'digit' },
  { label: '8', value: '8', kind: 'digit' },
  { label: '9', value: '9', kind: 'digit' },
  { label: '÷', value: '/', kind: 'muted' },
  { label: '%', value: '%', kind: 'muted' },
];
const ROW_456: KeyDef[] = [
  { label: '4', value: '4', kind: 'digit' },
  { label: '5', value: '5', kind: 'digit' },
  { label: '6', value: '6', kind: 'digit' },
  { label: '×', value: '*', kind: 'muted', span: 2 },
];
const ROW_123: KeyDef[] = [
  { label: '1', value: '1', kind: 'digit' },
  { label: '2', value: '2', kind: 'digit' },
  { label: '3', value: '3', kind: 'digit' },
  { label: '−', value: '-', kind: 'accent', span: 2 },
];
const ROW_0DOT: KeyDef[] = [
  { label: '0', value: '0', kind: 'digit' },
  { label: '.', value: '.', kind: 'digit' },
  { label: '=', value: '=', kind: 'muted' },
  { label: '+', value: '+', kind: 'accent', span: 2 },
];

function Key({ def, onPress }: { def: KeyDef; onPress: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPress(def.value)}
      style={def.span ? { gridColumn: `span ${def.span}` } : undefined}
      className={cn(
        'h-14 rounded-xl font-bold text-lg flex items-center justify-center active:scale-[0.95] transition-transform select-none',
        def.kind === 'digit' && 'bg-white text-slate-800 shadow-sm',
        def.kind === 'muted' && 'bg-blue-50 text-blue-900 shadow-sm',
        def.kind === 'accent' && 'bg-[#0b3d91] text-white shadow-sm'
      )}
    >
      {def.label}
    </button>
  );
}

export function TransactionEntryScreen({
  partyId,
  partyName,
  type,
  onClose,
}: {
  partyId: string;
  partyName: string;
  type: LedgerEntryType;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const createEntry = useCreateLedgerEntry();

  const [expression, setExpression] = useState('');
  const [memory, setMemory] = useState(0);
  const [description, setDescription] = useState('');
  const [billReference, setBillReference] = useState('');
  const [showBillField, setShowBillField] = useState(false);
  const [dueDate, setDueDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [showError, setShowError] = useState(false);
  // Once the user presses any numeric/operator key, the metadata panel
  // (details/bill/date/camera) locks open and never collapses again for the
  // rest of this session — even if the formula is later cleared or edited
  // back down to zero. Only a fresh mount (new entry sheet) or save resets it.
  const [hasInteracted, setHasInteracted] = useState(false);

  const isGet = type === LedgerEntryType.YOU_GOT;
  const hasFormula = /[+\-*/%]/.test(expression.replace(/^-/, ''));

  const liveResult = useMemo(() => {
    if (!expression) return 0;
    return evaluateCalculatorExpression(expression);
  }, [expression]);

  const displayAmount = liveResult ?? 0;
  // Whether the amount currently parses to something worth saving — drives
  // the "পরিমাণ লিখুন" placeholder, the formula sub-bar, and the SAVE button.
  const isActive = expression.length > 0 && displayAmount !== 0;
  // Whether the metadata panel should be shown — persistent once triggered,
  // unlike `isActive` which can flip back off as the formula is edited.
  const showMetadata = hasInteracted;

  const pressKey = (value: string) => {
    setShowError(false);
    if (value === 'C') {
      setExpression('');
      return;
    }
    if (value === 'DEL') {
      setExpression((prev) => prev.slice(0, -1));
      return;
    }
    if (value === '=') {
      const result = evaluateCalculatorExpression(expression);
      if (result === null) {
        setShowError(true);
        return;
      }
      setExpression(trimNumberForExpression(result));
      return;
    }
    if (value === 'M+' || value === 'M-') {
      const result = evaluateCalculatorExpression(expression);
      if (result === null) {
        setShowError(true);
        return;
      }
      setMemory((m) => (value === 'M+' ? m + result : m - result));
      toast.success(value === 'M+' ? `মেমোরিতে যোগ হয়েছে: ${formatCurrency(result)}` : `মেমোরি থেকে বিয়োগ হয়েছে: ${formatCurrency(result)}`);
      return;
    }
    // Any numeric/operator key press permanently unlocks the metadata panel.
    setHasInteracted(true);
    setExpression((prev) => prev + value);
  };

  const handleSave = () => {
    const finalAmount = evaluateCalculatorExpression(expression);
    if (finalAmount === null || finalAmount <= 0) {
      setShowError(true);
      toast.error('সঠিক হিসাব বা সংখ্যা লিখুন');
      return;
    }

    createEntry.mutate(
      {
        partyId,
        data: {
          type,
          amount: finalAmount,
          description,
          billReference: billReference || undefined,
          dueDate: dueDate || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(`সফলভাবে যুক্ত হয়েছে: ${formatCurrency(finalAmount)}`, {
            style: isGet
              ? { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' }
              : { background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' },
          });
          queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
          queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
          queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          onClose();
        },
        onError: () => {
          toast.error('লেনদেন সংরক্ষণ করা যায়নি');
        },
      }
    );
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col">
      {/* Contextual header */}
      <div className="flex items-center gap-2 px-3 py-3 bg-white border-b border-slate-100 shrink-0">
        <button
          type="button"
          onClick={onClose}
          aria-label="পিছনে যান"
          className={cn('w-9 h-9 shrink-0 rounded-full flex items-center justify-center active:scale-95 transition-all', isGet ? 'text-emerald-600' : 'text-red-500')}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className={cn('font-extrabold text-[15px] leading-tight truncate', isGet ? 'text-emerald-600' : 'text-red-500')}>
          {isGet ? `আপনি পেয়েছেন ${formatCurrency(displayAmount)} ` : `আপনি দিয়েছেন ${formatCurrency(displayAmount)} `}
          <span className="text-slate-700">{isGet ? `${partyName}-এর থেকে` : `${partyName}-কে`}</span>
        </h2>
      </div>

      {/* Content — no page scroll; metadata panel expands/collapses in place (STATE A <-> STATE B) */}
      <div className="flex-1 min-h-0 flex flex-col justify-start px-3 py-3 gap-3 overflow-hidden">
        {/* Amount card + live formula sub-bar */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden shrink-0">
          <div className="px-4 py-5">
            <span className={cn('text-3xl font-extrabold tracking-tight', isGet ? 'text-emerald-600' : 'text-red-500')}>
              {formatCurrency(displayAmount)}
            </span>
            {!isActive && <p className="text-xs font-semibold text-slate-400 mt-1">পরিমাণ লিখুন</p>}
          </div>
          {isActive && (
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
              <p className="text-sm font-mono font-medium text-slate-500 truncate">
                {formatExpressionForDisplay(expression)}
                {hasFormula && liveResult !== null ? ` = ${trimNumberForExpression(liveResult)}` : ''}
              </p>
            </div>
          )}
          {showError && (
            <div className="px-4 py-2 border-t border-red-100 bg-red-50">
              <p className="text-xs font-bold text-red-500">সঠিক হিসাব বা সংখ্যা লিখুন</p>
            </div>
          )}
        </div>

        {/* Metadata panel: hidden until the first key press, then locked open
            for the rest of the session regardless of later edits/clears. */}
        <div
          aria-hidden={!showMetadata}
          className={cn(
            'overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out shrink-0',
            showMetadata ? 'max-h-[320px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
          )}
        >
          <div className="flex flex-col gap-3 pt-0.5">
            {memory !== 0 && (
              <button
                type="button"
                tabIndex={showMetadata ? 0 : -1}
                onClick={() => setExpression((prev) => prev + (memory >= 0 ? `+${trimNumberForExpression(memory)}` : trimNumberForExpression(memory)))}
                className="w-full flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 text-xs font-bold text-blue-800 active:scale-[0.98] transition-transform"
              >
                <span>মেমোরি (M)</span>
                <span>{formatCurrency(memory)} · যোগ করতে ট্যাপ করুন</span>
              </button>
            )}

            {/* Description */}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              tabIndex={showMetadata ? 0 : -1}
              placeholder="বিস্তারিত লিখুন (পণ্য, বিল নং, পরিমাণ ইত্যাদি)"
              className="w-full h-11 px-4 rounded-xl bg-white border border-slate-200 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            {/* Bill reference: collapsed trigger -> input */}
            {showBillField ? (
              <input
                value={billReference}
                onChange={(e) => setBillReference(e.target.value)}
                placeholder="বিল/ইনভয়েস নম্বর"
                tabIndex={showMetadata ? 0 : -1}
                autoFocus
                className="w-full h-11 px-4 rounded-xl bg-white border border-slate-200 text-sm font-medium uppercase placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            ) : (
              <button
                type="button"
                tabIndex={showMetadata ? 0 : -1}
                onClick={() => setShowBillField(true)}
                className="flex items-center gap-1 text-sm font-bold text-primary px-1"
              >
                <Plus className="w-3.5 h-3.5" /> বিল নম্বর যুক্ত করুন
              </button>
            )}

            {/* Date + attach bills */}
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                tabIndex={showMetadata ? 0 : -1}
                className="h-11 px-3 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                tabIndex={showMetadata ? 0 : -1}
                onClick={() => toast('বিল সংযুক্তি শীঘ্রই আসছে')}
                className="h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-600 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Camera className="w-4 h-4" /> বিল সংযুক্ত করুন
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SAVE button, fixed above keypad — disabled while the amount isn't a valid non-zero total */}
      <div className="px-3 pt-1 shrink-0">
        <button
          type="button"
          onClick={handleSave}
          disabled={createEntry.isPending || !isActive}
          className={cn(
            'w-full h-14 rounded-xl font-extrabold text-white text-base shadow-[0_4px_14px_0_rgba(0,0,0,0.15)] active:scale-[0.98] transition-all disabled:opacity-40 disabled:active:scale-100',
            isGet ? 'bg-emerald-600' : 'bg-red-500'
          )}
        >
          এন্ট্রি নিশ্চিত করুন
        </button>
      </div>

      {/* Custom on-screen calculator keypad */}
      <div className="p-3 pb-4 space-y-2 shrink-0 bg-[#eef2f7]">
        <div className="grid grid-cols-4 gap-2">
          {ROW_MEMORY.map((k) => (
            <Key key={k.value} def={k} onPress={pressKey} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ROW_789.map((k) => (
            <Key key={k.value} def={k} onPress={pressKey} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ROW_456.map((k) => (
            <Key key={k.value} def={k} onPress={pressKey} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ROW_123.map((k) => (
            <Key key={k.value} def={k} onPress={pressKey} />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ROW_0DOT.map((k) => (
            <Key key={k.value} def={k} onPress={pressKey} />
          ))}
        </div>
      </div>
    </div>
  );
}
