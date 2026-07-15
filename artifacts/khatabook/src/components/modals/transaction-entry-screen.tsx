import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateLedgerEntry,
  LedgerEntryType,
  getListLedgerEntriesQueryKey,
  getGetPartyQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
  type LedgerEntry,
  type Party,
  type DashboardSummary,
} from '@workspace/api-client-react';
import { ChevronLeft, Camera, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn, evaluateCalculatorExpression, formatCurrency, formatExpressionForDisplay, trimNumberForExpression } from '@/lib/utils';
import { applyBalanceDelta, shiftSummaryForPartyChange } from '@/lib/optimistic';
import { CameraCaptureModal } from '@/components/modals/camera-capture-modal';
import { scanDocument } from '@/lib/document-scan';

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

// Memoized so a parent re-render (typing, memory updates, description edits,
// etc.) never re-renders the 20+ key buttons — only `onPress` identity and
// `def` (a stable module-level constant) are compared, and `onPress` is a
// useCallback below, so in practice these never re-render after mount.
const Key = memo(function Key({ def, onPress }: { def: KeyDef; onPress: (value: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPress(def.value)}
      style={{
        ...(def.span ? { gridColumn: `span ${def.span}` } : undefined),
        // Hardware-accelerated, GPU-composited layer: the browser can flip
        // the `:active` background on its own compositor thread instead of
        // repainting, so there's zero lag on low-end mobile devices even
        // during fast repeated taps.
        transform: 'translate3d(0,0,0)',
        backfaceVisibility: 'hidden',
        willChange: 'background-color',
      }}
      className={cn(
        'h-14 rounded-xl font-bold text-lg flex items-center justify-center active:scale-[0.95] transition-[background-color,transform] duration-[50ms] ease-out select-none',
        // Tactile press feedback: every key — digit, operator, or memory
        // control — flashes to a warm charcoal-brown the instant it's
        // pressed, then snaps back on release, like a phone dialer keypad.
        // This is pure CSS :active — no React state involved, so pressing
        // a key never triggers a re-render just for the visual feedback.
        'active:bg-[#4A3C31] active:text-white active:shadow-none',
        def.kind === 'digit' && 'bg-white text-slate-800 shadow-sm',
        def.kind === 'muted' && 'bg-blue-50 text-blue-900 shadow-sm',
        def.kind === 'accent' && 'bg-[#0b3d91] text-white shadow-sm'
      )}
    >
      {def.label}
    </button>
  );
});

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
  // Optimistic mutation: onMutate applies the expected ledger/balance/
  // dashboard changes to the cache synchronously (instant UI, no spinner),
  // onError silently rolls back if the background request fails, and
  // onSettled reconciles with the server's authoritative response in the
  // background. `handleSave` below fires this and returns to the ledger
  // view in the same tick — it never awaits the network.
  const createEntry = useCreateLedgerEntry({
    mutation: {
      onMutate: async ({ partyId, data }) => {
        const entriesKey = getListLedgerEntriesQueryKey(partyId);
        const partyKey = getGetPartyQueryKey(partyId);
        const partiesKey = getListPartiesQueryKey();
        const summaryKey = getGetDashboardSummaryQueryKey();

        const previousEntries = queryClient.getQueryData<LedgerEntry[]>(entriesKey);
        const previousParty = queryClient.getQueryData<Party>(partyKey);
        const previousParties = queryClient.getQueryData<Party[]>(partiesKey);
        const previousSummary = queryClient.getQueryData<DashboardSummary>(summaryKey);

        const optimisticEntry: LedgerEntry = {
          id: `optimistic-${Date.now()}`,
          partyId,
          type: data.type,
          amount: data.amount,
          description: data.description ?? '',
          billReference: data.billReference ?? null,
          billImage: data.billImage ?? null,
          dueDate: data.dueDate ?? null,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<LedgerEntry[]>(entriesKey, (old) => [optimisticEntry, ...(old ?? [])]);

        const delta = data.type === LedgerEntryType.YOU_GAVE ? data.amount : -data.amount;
        const updatedParty = previousParty ? applyBalanceDelta(previousParty, delta) : undefined;
        if (updatedParty) {
          queryClient.setQueryData<Party>(partyKey, { ...updatedParty, lastTransactionAt: optimisticEntry.createdAt });
        }
        if (previousParties) {
          queryClient.setQueryData<Party[]>(
            partiesKey,
            previousParties.map((p) =>
              p.id === partyId ? { ...applyBalanceDelta(p, delta), lastTransactionAt: optimisticEntry.createdAt } : p
            )
          );
        }
        if (previousSummary) {
          queryClient.setQueryData<DashboardSummary>(summaryKey, shiftSummaryForPartyChange(previousSummary, previousParty, updatedParty));
        }

        return { entriesKey, partyKey, partiesKey, summaryKey, previousEntries, previousParty, previousParties, previousSummary };
      },
      onError: (err, _vars, context) => {
        console.error('লেনদেন সংরক্ষণ ব্যর্থ হয়েছে, পরিবর্তন ফিরিয়ে নেওয়া হচ্ছে:', err);
        if (!context) return;
        queryClient.setQueryData(context.entriesKey, context.previousEntries);
        queryClient.setQueryData(context.partyKey, context.previousParty);
        queryClient.setQueryData(context.partiesKey, context.previousParties);
        queryClient.setQueryData(context.summaryKey, context.previousSummary);
      },
      onSettled: (_data, _err, { partyId }) => {
        // Silent background reconciliation — replaces the optimistic
        // temp-id entry / estimated balances with the server's real data
        // without ever blocking or flashing a loading state.
        queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      },
    },
  });

  const [expression, setExpression] = useState('');
  // Dedicated calculator memory register (M+/M-/MR/MC), independent of the
  // live expression/result state above.
  const [memoryValue, setMemoryValue] = useState(0);
  // Full log of every M+/M- operation this session, newest last — rendered
  // as a scrollable history list. The memory UI (history list + MRC bar) is
  // visible exactly when this array is non-empty; there is no separate
  // visibility flag to keep in sync.
  const [memoryHistory, setMemoryHistory] = useState<string[]>([]);
  const isMemoryActive = memoryHistory.length > 0;
  const clearMemory = useCallback(() => {
    memoryValueRef.current = 0;
    setMemoryValue(0);
    setMemoryHistory([]);
  }, []);
  // Tap the MRC bar once to recall the memory value into the expression;
  // tap it again right after (with no other key press in between) to clear
  // the memory instead — classic calculator MRC semantics, not time-based.
  const justRecalledRef = useRef(false);
  // Live memory total kept in a ref alongside state: pressKey/handleMrcTap
  // read the ref for same-tick math (no stale-closure risk from batched
  // setState) while `memoryValue` state still drives the on-screen render.
  const memoryValueRef = useRef(0);
  // Mirrors `expression` so pressKey (a stable, zero-dependency useCallback)
  // can read the latest typed value without closing over stale state or
  // embedding side effects inside a setState updater function — updaters
  // must stay pure, so all M+/M- bookkeeping happens outside of one.
  const expressionRef = useRef('');
  useEffect(() => {
    expressionRef.current = expression;
  }, [expression]);
  const handleMrcTap = useCallback(() => {
    if (justRecalledRef.current) {
      clearMemory();
      justRecalledRef.current = false;
      return;
    }
    setExpression(trimNumberForExpression(memoryValueRef.current));
    setHasInteracted(true);
    justRecalledRef.current = true;
  }, [clearMemory]);
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [showError, setShowError] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [billImage, setBillImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Pre-computed once per expression/result change rather than re-formatted
  // inline in JSX on every render (e.g. from unrelated state like
  // `description` or `dueDate` edits) — keeps the render loop free of string
  // work while typing.
  const formulaPreviewText = useMemo(() => {
    const base = expression ? formatExpressionForDisplay(expression) : '0';
    const suffix = hasFormula && liveResult !== null ? ` = ${trimNumberForExpression(liveResult)}` : '';
    return `${base}${suffix}`;
  }, [expression, hasFormula, liveResult]);

  // Once memory logs exist, the big header amount tracks the running memory
  // total rather than whatever is currently being typed for the next entry —
  // the typed expression still gets its own live preview bar below.
  const displayAmount = memoryHistory.length > 0 ? memoryValue : (liveResult ?? 0);
  // Whether the amount currently parses to something worth saving — drives
  // the "পরিমাণ লিখুন" placeholder, the formula sub-bar, and the SAVE button.
  const isActive = memoryHistory.length > 0 ? memoryValue !== 0 : expression.length > 0 && displayAmount !== 0;
  // Whether the metadata panel should be shown — persistent once triggered,
  // unlike `isActive` which can flip back off as the formula is edited.
  const showMetadata = hasInteracted;

  const processCapturedImage = useCallback(async (dataUrl: string) => {
    setIsScanning(true);
    try {
      const scanned = await scanDocument(dataUrl);
      // Success is silently visible: the thumbnail appears in the metadata
      // panel the instant `billImage` is set — no toast needed.
      setBillImage(scanned);
    } catch (err) {
      // Falls back to the raw captured photo rather than blocking the user
      // with an error toast — they can still attach it or retake it.
      console.error('বিল স্ক্যান করা যায়নি, মূল ছবি ব্যবহার করা হচ্ছে:', err);
      setBillImage(dataUrl);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleAttachClick = useCallback(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
      setIsCameraOpen(true);
    } else {
      fileInputRef.current?.click();
    }
  }, []);

  const handleCameraCapture = useCallback(
    (dataUrl: string) => {
      setIsCameraOpen(false);
      void processCapturedImage(dataUrl);
    },
    [processCapturedImage]
  );

  const handleCameraError = useCallback(() => {
    setIsCameraOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          void processCapturedImage(reader.result);
        }
      };
      reader.readAsDataURL(file);
    },
    [processCapturedImage]
  );

  // Stable across renders (useCallback with a functional-setState style body
  // that reads current expression/memory via refs) so the memoized <Key>
  // grid never has to re-render just because this identity changed —
  // keystrokes stay off the render path entirely except for the one state
  // update they actually need.
  const pressKey = useCallback((value: string) => {
    setShowError(false);
    // Any keypad press other than the MRC bar breaks the recall→clear combo.
    justRecalledRef.current = false;
    if (value === 'C') {
      setExpression('');
      return;
    }
    if (value === 'DEL') {
      setExpression((prev) => prev.slice(0, -1));
      return;
    }
    if (value === '=') {
      const result = evaluateCalculatorExpression(expressionRef.current);
      if (result === null) {
        setShowError(true);
        return;
      }
      setExpression(trimNumberForExpression(result));
      return;
    }
    if (value === 'M+' || value === 'M-') {
      // Evaluate whatever expression is currently typed; an empty or
      // invalid expression is treated as 0 rather than blocking the memory
      // operation. The log label keeps the raw typed expression (e.g.
      // "500×") rather than its evaluated value, so multi-step entries stay
      // legible in the history.
      const currentExpression = expressionRef.current;
      const result = currentExpression ? evaluateCalculatorExpression(currentExpression) : 0;
      const safeValue = result !== null && Number.isFinite(result) ? result : 0;
      const label = currentExpression ? formatExpressionForDisplay(currentExpression) : '0';
      const newMemoryValue = value === 'M+' ? memoryValueRef.current + safeValue : memoryValueRef.current - safeValue;
      memoryValueRef.current = newMemoryValue;
      setMemoryValue(newMemoryValue);
      setMemoryHistory((prev) => [...prev, `${value}(${label})=${newMemoryValue.toFixed(1)}`]);
      // Clear the typed expression so the next number starts fresh for the
      // following memory entry.
      expressionRef.current = '';
      setExpression('');
      justRecalledRef.current = false;
      // Silent by design: no toast/alert here — the running total and
      // history list already update instantly, so a notification would
      // just interrupt fast, repeated M+/M- entry.
      return;
    }
    // Any numeric/operator key press permanently unlocks the metadata panel.
    setHasInteracted(true);
    setExpression((prev) => prev + value);
  }, []);

  const handleSave = useCallback(() => {
    // If memory logs exist, the grand total accumulated in memory is the
    // authoritative amount to save — it already reflects every M+/M- entry.
    // Otherwise fall back to whatever is currently typed in the expression.
    const finalAmount = memoryHistory.length > 0 ? memoryValue : evaluateCalculatorExpression(expression);
    if (finalAmount === null || finalAmount <= 0) {
      // Inline error state only (a red highlight on the formula line) —
      // no toast/blocking dialog for a validation issue the user can see
      // and fix on this same screen.
      setShowError(true);
      return;
    }

    // Optimistic UI: commit to the final view instantly. The memory log is
    // scoped to this transaction entry, so it's cleared the moment the
    // amount is handed off — the actual network write happens silently in
    // the background (see the mutation's onMutate/onError/onSettled above)
    // and is never awaited here.
    clearMemory();
    onClose();
    createEntry.mutate({
      partyId,
      data: {
        type,
        amount: finalAmount,
        description,
        billReference: undefined,
        billImage: billImage ?? undefined,
        dueDate: dueDate || undefined,
      },
    });
  }, [memoryHistory.length, memoryValue, expression, createEntry, partyId, type, description, billImage, dueDate, clearMemory, onClose]);

  return (
    <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col">
      {/* Contextual header */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-[calc(0.75rem+var(--safe-top))] bg-white border-b border-slate-100 shrink-0">
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
          {/* Live memory history list: every M+/M- entry logged this session,
              newest at the bottom, scrollable once it grows past a few
              lines. Completely hidden until the first M+/M- press. */}
          {isMemoryActive && (
            <div
              className="max-h-28 overflow-y-auto px-4 py-2 border-t border-slate-100 bg-slate-50/60 space-y-1"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {memoryHistory.map((log, i) => (
                <p key={i} className="text-sm font-mono font-medium text-slate-700 truncate">
                  {log}
                </p>
              ))}
            </div>
          )}
          {/* Calculator formula sub-bar: live preview of whatever is
              currently being typed for the next entry (or the plain amount
              when memory isn't in use). Shown alongside the history list
              above, not instead of it. */}
          {showMetadata && (
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60">
              <p className="text-sm font-mono font-medium text-slate-500 truncate">
                {formulaPreviewText}
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
            {/* Description */}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              tabIndex={showMetadata ? 0 : -1}
              placeholder="বিস্তারিত লিখুন (পণ্য, বিল নং, পরিমাণ ইত্যাদি)"
              className="w-full h-11 px-4 rounded-xl bg-white border border-slate-200 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            {/* Date + attach bills */}
            <div className="grid grid-cols-2 gap-3 -mt-1.5">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                tabIndex={showMetadata ? 0 : -1}
                className="h-11 px-3 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {billImage ? (
                <div className="h-11 flex items-center justify-end gap-2">
                  <div className="relative h-11 w-11 shrink-0">
                    <img
                      src={billImage}
                      alt="সংযুক্ত বিল"
                      className="w-full h-full rounded-xl object-cover border border-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => setBillImage(null)}
                      aria-label="বিল সংযুক্তি সরান"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm active:scale-90 transition-transform"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    tabIndex={showMetadata ? 0 : -1}
                    onClick={handleAttachClick}
                    aria-label="আরও বিল যুক্ত করুন"
                    className="h-11 w-11 shrink-0 rounded-xl bg-emerald-500 text-white flex items-center justify-center active:scale-[0.95] transition-transform"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  tabIndex={showMetadata ? 0 : -1}
                  onClick={handleAttachClick}
                  className="h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-600 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Camera className="w-4 h-4" /> বিল সংযুক্ত করুন
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

      {isCameraOpen && (
        <CameraCaptureModal onCapture={handleCameraCapture} onClose={() => setIsCameraOpen(false)} onError={handleCameraError} />
      )}

      {isScanning && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
          <p className="text-white text-sm font-semibold">স্ক্যানিং হচ্ছে...</p>
        </div>
      )}

      {/* SAVE button, fixed above keypad — disabled while the amount isn't a valid non-zero total */}
      <div className="px-3 pt-1 shrink-0">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isActive}
          className={cn(
            'w-full h-14 rounded-xl font-extrabold text-white text-base shadow-[0_4px_14px_0_rgba(0,0,0,0.15)] active:scale-[0.98] transition-all disabled:opacity-40 disabled:active:scale-100',
            isGet ? 'bg-emerald-600' : 'bg-red-500'
          )}
        >
          এন্ট্রি নিশ্চিত করুন
        </button>
      </div>

      {/* Custom on-screen calculator keypad — promoted to its own GPU
          compositor layer so key presses never trigger a main-thread paint
          of the whole grid on low-end mobile devices. */}
      <div
        className="pt-3 pr-3 pl-3 pb-[calc(1rem+var(--safe-bottom))] space-y-2 shrink-0 bg-[#eef2f7]"
        style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }}
      >
        {/* MRC bar: shown whenever the memory history has at least one
            entry. Tap once to recall the running total into the expression;
            tap again right after (no other key in between) to clear the
            entire memory log. */}
        {isMemoryActive && (
          <button
            type="button"
            onClick={handleMrcTap}
            className="w-full h-12 rounded-xl bg-[#0b3d91] text-white font-extrabold text-base flex items-center justify-center active:scale-[0.98] active:bg-[#4A3C31] transition-[background-color,transform] duration-[50ms] ease-out"
          >
            MRC = {formatCurrency(memoryValue)}
          </button>
        )}
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
