import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateLedgerEntry,
  useListParties,
  LedgerEntryType,
  getListLedgerEntriesQueryKey,
  getGetPartyQueryKey,
  getListPartiesQueryKey,
  getGetDashboardSummaryQueryKey,
  type LedgerEntry,
  type Party,
  type DashboardSummary,
} from '@workspace/api-client-react';
import { ChevronLeft, Camera, X, ArrowLeftRight } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn, evaluateCalculatorExpression, formatCurrency, formatCurrencyTyping, formatExpressionForDisplay, toBengaliDigits, trimNumberForExpression } from '@/lib/utils';
import { applyBalanceDelta, shiftSummaryForPartyChange } from '@/lib/optimistic';
import { CameraCaptureModal } from '@/components/modals/camera-capture-modal';
import { scanDocument } from '@/lib/document-scan';
import { uploadBillImage, billImageSrc, type BillImageUploadResult } from '@/lib/billImageStorage';
import { savePendingUpload } from '@/lib/pendingUploads';

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
  initialEntry,
}: {
  partyId: string;
  partyName: string;
  type: LedgerEntryType;
  onClose: () => void;
  /** When provided the screen opens in edit mode, pre-populated with the
   *  existing entry's data. Saving issues a PATCH instead of a POST. */
  initialEntry?: LedgerEntry;
}) {
  const isEditMode = !!initialEntry;
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  /** Stores the cloud-storage path of the bill image already on the entry so
   *  handleUpdate can keep it unchanged when the user hasn't replaced it. */
  const originalBillImagePathRef = useRef<string | null>(initialEntry?.billImage ?? null);
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
          isTransfer: data.isTransfer ?? false,
          transferPartyId: data.transferPartyId ?? null,
          linkedEntryId: null,
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
      onSettled: (_data, _err, { partyId, data }) => {
        // Silent background reconciliation — replaces the optimistic
        // temp-id entry / estimated balances with the server's real data
        // without ever blocking or flashing a loading state.
        queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        // For transfer entries, also refresh the counter-party's data.
        if (data.transferPartyId) {
          queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(data.transferPartyId) });
          queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(data.transferPartyId) });
        }
      },
    },
  });

  // In edit mode: pre-populate the expression with the existing amount so the
  // user sees the current value immediately when the screen opens.
  const [expression, setExpression] = useState(() =>
    isEditMode ? trimNumberForExpression(initialEntry!.amount) : ''
  );
  // Dedicated calculator memory register (M+/M-/MR/MC), independent of the
  // live expression/result state above.
  const [memoryValue, setMemoryValue] = useState(0);
  // Full log of every M+/M- operation this session, newest last — rendered
  // as a scrollable history list. The memory UI (history list + MRC bar) is
  // visible exactly when this array is non-empty; there is no separate
  // visibility flag to keep in sync.
  const [memoryHistory, setMemoryHistory] = useState<string[]>([]);
  const isMemoryActive = memoryHistory.length > 0;
  // Remembers the last "500×100 = 50000" formula text so the sub-bar keeps
  // showing it after = resolves the expression to a plain number.
  // Cleared the moment any new key is pressed.
  const [lastFormulaText, setLastFormulaText] = useState('');
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
  const [description, setDescription] = useState(initialEntry?.description ?? '');
  const [dueDate, setDueDate] = useState(() => {
    if (isEditMode) {
      // Use the stored transaction date (dueDate field) if present; otherwise
      // fall back to the server-assigned createdAt timestamp.
      const raw = initialEntry!.dueDate ?? initialEntry!.createdAt;
      return format(new Date(raw as string), 'yyyy-MM-dd');
    }
    return format(new Date(), 'yyyy-MM-dd');
  });
  const [showError, setShowError] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  // Local display copy of the bill image (base64 while uploading, then objectPath after save).
  // In edit mode, start with the existing entry's image so the user sees it immediately.
  const [billImage, setBillImage] = useState<string | null>(() =>
    initialEntry?.billImage ? (billImageSrc(initialEntry.billImage) ?? null) : null
  );
  // Mirrors the raw base64 data URL set at image capture time so handleSave
  // can access it synchronously even after onClose() clears component state.
  // Needed to persist a retry record when the upload fails.
  const pendingBase64Ref = useRef<string | null>(null);
  // Background upload promise started as soon as the image is scanned/selected.
  // By the time the user fills in the amount and presses save, the upload is
  // almost always already complete — so awaiting it in handleSave adds no
  // perceptible delay.
  const uploadPromiseRef = useRef<Promise<BillImageUploadResult> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Once the user presses any numeric/operator key, the metadata panel
  // (details/bill/date/camera) locks open and never collapses again for the
  // rest of this session — even if the formula is later cleared or edited
  // back down to zero. In edit mode it starts open immediately so all fields
  // are visible without requiring a keypad interaction first.
  const [hasInteracted, setHasInteracted] = useState(isEditMode);

  // ── Transfer / adjustment state (create mode only) ────────────────────────
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [transferPartyId, setTransferPartyId] = useState<string | null>(null);
  const [transferSearch, setTransferSearch] = useState('');

  // Fetch party list for the transfer dropdown (only when toggle is on).
  const { data: transferPartyList = [] } = useListParties(
    { search: transferSearch || undefined },
    { query: { enabled: isTransferMode && !isEditMode } },
  );
  const transferPartyOptions = transferPartyList.filter((p) => p.id !== partyId);

  // Controls the "unsaved changes" confirmation dialog shown when the user
  // presses back with a dirty edit-mode form.
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const isGet = type === LedgerEntryType.YOU_GOT;
  const hasFormula = /[+\-*/%]/.test(expression.replace(/^-/, ''));

  const liveResult = useMemo(() => {
    if (!expression) return 0;
    return evaluateCalculatorExpression(expression) ?? 0;
  }, [expression]);

  // Split expression into:
  //   accumulatedExpr — everything up to and including the last operator
  //                     e.g. "500+200+" → "500+200+",  "500+" → "500+"
  //   currentOperand  — whatever the user is typing right now (after last op)
  //                     e.g. "500+200"  → "200",        "500+" → ""
  // A leading '-' (negative literal) is never treated as an operator here.
  const [currentOperand, accumulatedExpr] = useMemo(() => {
    if (!expression) return ['', ''];
    let lastOpIdx = -1;
    for (let i = expression.length - 1; i > 0; i--) {
      const c = expression[i];
      if (c === '+' || c === '-' || c === '*' || c === '/') {
        lastOpIdx = i;
        break;
      }
    }
    if (lastOpIdx === -1) return [expression, ''];
    return [expression.slice(lastOpIdx + 1), expression.slice(0, lastOpIdx + 1)];
  }, [expression]);

  // Sub-bar formula text — always shows the full expression + live result
  // e.g. "500× = 500", "500×100 = 50000", and after = stays as "500×100 = 50000".
  const formulaPreviewText = useMemo(() => {
    const toDisplay = (s: string) => toBengaliDigits(formatExpressionForDisplay(s));
    if (!expression) return toBengaliDigits(lastFormulaText);
    const displayExpr = toDisplay(expression);
    // Evaluate — strip trailing operator for partial expressions
    const directResult = evaluateCalculatorExpression(expression);
    const partialResult =
      directResult !== null
        ? directResult
        : evaluateCalculatorExpression(expression.replace(/[+\-*/]+$/, ''));
    if (partialResult === null) return displayExpr;
    return `${displayExpr} = ${toBengaliDigits(trimNumberForExpression(partialResult))}`;
  }, [expression, lastFormulaText]);

  // True when any editable field differs from the entry's original saved value.
  // Only meaningful in edit mode — always false in create mode.
  // Must live after `liveResult` and `formulaPreviewText` which it depends on.
  const isDirty = useMemo(() => {
    if (!isEditMode || !initialEntry) return false;

    // Amount: compare the live evaluated result against the stored amount.
    const currentAmount =
      memoryHistory.length > 0 ? memoryValue : (liveResult ?? 0);
    if (Math.abs(currentAmount - initialEntry.amount) > 0.001) return true;

    // Description
    if (description !== (initialEntry.description ?? '')) return true;

    // Transaction date
    const initialDateStr = format(
      new Date((initialEntry.dueDate ?? initialEntry.createdAt) as string),
      'yyyy-MM-dd',
    );
    if (dueDate !== initialDateStr) return true;

    // Bill image (user attached a new image or removed the existing one)
    const initialBillDisplay = initialEntry.billImage
      ? (billImageSrc(initialEntry.billImage) ?? null)
      : null;
    if (billImage !== initialBillDisplay) return true;

    return false;
  }, [
    isEditMode, initialEntry,
    memoryHistory.length, memoryValue, liveResult,
    description, dueDate, billImage,
  ]);

  // The authoritative amount used for saving and the header title — always
  // the fully-evaluated expression result, or the memory total.
  const displayAmount = memoryHistory.length > 0 ? memoryValue : (liveResult ?? 0);

  // Classic calculator big-display — mirrors the reference screenshots:
  //   Memory mode           → formatted running total (e.g. ৳1,500)
  //   No operator yet       → formatted number being typed (e.g. ৳500)
  //   Operator just pressed → number + operator symbol  (e.g. ৳500×)
  //                           currentOperand is "" in this state
  //   Second operand typing → formatted second operand  (e.g. ৳100)
  const bigDisplayText = useMemo(() => {
    if (memoryHistory.length > 0) return formatCurrency(memoryValue);
    if (!expression) return null;

    if (accumulatedExpr) {
      if (currentOperand !== '') {
        // Second operand is being typed — mirror exactly what the user typed.
        // formatCurrencyTyping shows only as many decimal places as typed
        // (e.g. "0.5" → "৳০.৫", not "৳০.৫০") so trailing zeros never appear
        // unless the user explicitly pressed that digit.
        const num = parseFloat(currentOperand);
        const base = formatCurrencyTyping(currentOperand, isNaN(num) ? 0 : num);
        return currentOperand.endsWith('.') ? base + '.' : base;
      }
      // Operator was just pressed — show "৳500×".
      // accumulatedExpr ends with the operator char (+, -, *, /)
      const opChar = accumulatedExpr.slice(-1);
      const opSymbol = opChar === '*' ? '×' : opChar === '/' ? '÷' : opChar === '-' ? '−' : '+';
      const numPart = accumulatedExpr.slice(0, -1);
      // Evaluate the accumulated number part (handles chained ops like 500+200)
      const num = evaluateCalculatorExpression(numPart) ?? parseFloat(numPart);
      return `${formatCurrency(isNaN(num) ? 0 : num)}${opSymbol}`;
    }

    // No operator — plain number being typed.
    // Use formatCurrencyTyping so "0.5" shows as "৳০.৫", not "৳০.৫০".
    const num = parseFloat(expression);
    const base = formatCurrencyTyping(expression, isNaN(num) ? 0 : num);
    return expression.endsWith('.') ? base + '.' : base;
  }, [memoryHistory.length, memoryValue, expression, accumulatedExpr, currentOperand]);

  // isActive: true whenever there's something meaningful to save
  const isActive = memoryHistory.length > 0 ? memoryValue !== 0 : expression.length > 0;
  // Whether the metadata panel should be shown — persistent once triggered,
  // unlike `isActive` which can flip back off as the formula is edited.
  const showMetadata = hasInteracted;

  const processCapturedImage = useCallback(async (dataUrl: string) => {
    setIsScanning(true);
    try {
      const scanned = await scanDocument(dataUrl);
      // Show the scanned image as a local thumbnail immediately.
      setBillImage(scanned);
      // Keep the raw base64 available for a retry record if the upload fails.
      pendingBase64Ref.current = scanned;
      // Start the background upload right away so that by the time the user
      // fills in the amount and presses save, the upload is likely complete.
      uploadPromiseRef.current = uploadBillImage(scanned);
    } catch (err) {
      // Falls back to the raw captured photo rather than blocking the user
      // with an error toast — they can still attach it or retake it.
      console.error('বিল স্ক্যান করা যায়নি, মূল ছবি ব্যবহার করা হচ্ছে:', err);
      setBillImage(dataUrl);
      pendingBase64Ref.current = dataUrl;
      uploadPromiseRef.current = uploadBillImage(dataUrl);
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
      // Save the formula so sub-bar keeps showing "500×100 = 50000" after =
      const formulaDisplay = formatExpressionForDisplay(expressionRef.current);
      setLastFormulaText(`${formulaDisplay} = ${trimNumberForExpression(result)}`);
      setExpression(trimNumberForExpression(result));
      return;
    }
    // Any key other than = clears the saved formula (new calculation starts)
    setLastFormulaText('');
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
    // Guard: prevent a second decimal point in the current operand.
    //
    // The expression is a sequence of operands separated by operators
    // (+, -, *, /). We slice off everything after the last operator to get
    // the "current operand" being typed, and block "." if that segment
    // already contains one — matching the behaviour of every physical
    // calculator and preventing unparseable strings like "23.4.5".
    //
    // Example: expression = "100+23.4", user presses "."
    //   lastOpIdx = 3  (the "+")
    //   currentOperand = "23.4"  → already has "." → block, return "100+23.4"
    if (value === '.') {
      setHasInteracted(true);
      setExpression((prev) => {
        const lastOpIdx = Math.max(
          prev.lastIndexOf('+'),
          prev.lastIndexOf('-'),
          prev.lastIndexOf('*'),
          prev.lastIndexOf('/'),
        );
        const currentOperand = prev.slice(lastOpIdx + 1);
        if (currentOperand.includes('.')) return prev;   // already has decimal — block
        if (currentOperand === '') return prev + '0.';   // empty operand → "0." auto-prepend
        return prev + '.';
      });
      return;
    }

    // Any numeric/operator key press permanently unlocks the metadata panel.
    setHasInteracted(true);
    setExpression((prev) => prev + value);
  }, []);

  /**
   * Edit-mode save: issues an optimistic PATCH for the existing entry.
   *
   * Pattern mirrors handleDelete in TransactionDetailPage:
   *   1. Snapshot caches.
   *   2. Update entry in the list + adjust party balance.
   *   3. Close the edit overlay immediately.
   *   4. Fire PATCH in the background.
   *   5. On success: invalidate caches for server truth.
   *   6. On failure: restore snapshots + show non-blocking toast.
   */
  const handleUpdate = useCallback(() => {
    if (!initialEntry) return;

    const finalAmount =
      memoryHistory.length > 0
        ? memoryValue
        : evaluateCalculatorExpression(expression);
    if (finalAmount === null || finalAmount <= 0) {
      setShowError(true);
      return;
    }

    const entriesKey = getListLedgerEntriesQueryKey(partyId);
    const partyKey   = getGetPartyQueryKey(partyId);
    const partiesKey = getListPartiesQueryKey();
    const summaryKey = getGetDashboardSummaryQueryKey();

    // ── 1. Snapshot ──────────────────────────────────────────────────────
    const previousEntries = queryClient.getQueryData<LedgerEntry[]>(entriesKey);
    const previousParty   = queryClient.getQueryData<Party>(partyKey);
    const previousParties = queryClient.getQueryData<Party[]>(partiesKey);
    const previousSummary = queryClient.getQueryData<DashboardSummary>(summaryKey);

    // ── 2. Optimistic cache update ────────────────────────────────────────
    const updatedEntry: LedgerEntry = {
      ...initialEntry,
      amount:      finalAmount,
      type,
      description,
      dueDate:     dueDate
        ? (new Date(`${dueDate}T00:00:00`) as unknown as null)
        : null,
    };
    queryClient.setQueryData<LedgerEntry[]>(entriesKey, (old) =>
      (old ?? []).map((e) => (e.id === initialEntry.id ? updatedEntry : e))
    );

    // Reverse the old entry's balance effect, then apply the new one.
    const oldDelta = initialEntry.type === LedgerEntryType.YOU_GAVE
      ?  initialEntry.amount
      : -initialEntry.amount;
    const newDelta = type === LedgerEntryType.YOU_GAVE
      ?  finalAmount
      : -finalAmount;
    const netDelta = newDelta - oldDelta;

    const updatedParty = previousParty
      ? applyBalanceDelta(previousParty, netDelta)
      : undefined;

    if (updatedParty) {
      queryClient.setQueryData<Party>(partyKey, updatedParty);
      queryClient.setQueryData<Party[]>(partiesKey, (old) =>
        (old ?? []).map((p) => (p.id === partyId ? applyBalanceDelta(p, netDelta) : p))
      );
    }
    if (previousSummary && previousParty && updatedParty) {
      queryClient.setQueryData<DashboardSummary>(
        summaryKey,
        shiftSummaryForPartyChange(previousSummary, previousParty, updatedParty),
      );
    }

    // ── 3. Close edit overlay immediately ────────────────────────────────
    clearMemory();
    onClose();

    // Capture refs before any state is cleared so the async block can
    // access them even after unmount.
    const pendingUpload  = uploadPromiseRef.current;
    const origPath       = originalBillImagePathRef.current;
    const capturedBase64 = pendingBase64Ref.current;
    uploadPromiseRef.current = null;
    pendingBase64Ref.current = null;

    // ── 4. Background PATCH ───────────────────────────────────────────────
    void (async () => {
      // Determine the final bill-image object path to send:
      //   • null  → user explicitly removed the image
      //   • new upload pending → await it, use new objectPath
      //   • unchanged → keep the server's existing path (send nothing)
      let objectPath: string | null | undefined = origPath; // default: unchanged
      let billImageChanged = false;

      if (billImage === null) {
        objectPath = null;
        billImageChanged = true;
      } else if (pendingUpload) {
        billImageChanged = true;
        const result = await pendingUpload;
        if (result.ok) {
          objectPath = result.objectPath;
        } else {
          objectPath = origPath; // keep existing on upload failure
          toast.warning('বিল ছবি আপডেট হয়নি', {
            description: 'নেটওয়ার্ক সমস্যায় নতুন ছবি সংরক্ষণ হয়নি।',
            duration: 5000,
          });
          if (capturedBase64 && initialEntry.id) {
            savePendingUpload({ entryId: initialEntry.id, partyId, base64: capturedBase64 });
          }
        }
      }

      try {
        const res = await fetch(
          `${BASE}/api/parties/${partyId}/ledger-entries/${initialEntry.id}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount:      finalAmount,
              type,
              description,
              dueDate:     dueDate || undefined,
              ...(billImageChanged ? { billImage: objectPath } : {}),
            }),
          },
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error('[PATCH] server error body:', JSON.stringify(errBody));
          throw new Error(`HTTP ${res.status}: ${JSON.stringify(errBody)}`);
        }

        // ── 5. Background reconciliation ──────────────────────────────────
        queryClient.invalidateQueries({ queryKey: entriesKey });
        queryClient.invalidateQueries({ queryKey: partyKey });
        queryClient.invalidateQueries({ queryKey: partiesKey });
        queryClient.invalidateQueries({ queryKey: summaryKey });
      } catch (err) {
        console.error('Edit entry failed, rolling back:', err);

        // ── 6. Rollback on failure ────────────────────────────────────────
        queryClient.setQueryData(entriesKey, previousEntries);
        queryClient.setQueryData(partyKey,   previousParty);
        queryClient.setQueryData(partiesKey, previousParties);
        queryClient.setQueryData(summaryKey, previousSummary);
        toast.error('লেনদেন আপডেট ব্যর্থ হয়েছে — পরিবর্তন বাতিল হয়েছে');
      }
    })();
  }, [
    initialEntry, memoryHistory.length, memoryValue, expression,
    partyId, type, description, dueDate, billImage,
    queryClient, clearMemory, onClose, BASE,
  ]);

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

    // Validate transfer selection before doing anything else.
    if (isTransferMode && !transferPartyId) {
      toast.warning('কাস্টমার বেছে নিন', {
        description: 'অ্যাডজাস্টমেন্টের জন্য একটি কাস্টমার নির্বাচন করুন।',
        duration: 3000,
      });
      return;
    }

    // Optimistic UI: close the entry screen immediately so the user never
    // waits. The memory log is scoped to this transaction entry, so it's
    // cleared the moment the amount is handed off.
    clearMemory();
    onClose();

    // Capture refs before clearing any state so the async block below can
    // access them even after onClose() unmounts or resets the component.
    const pendingUpload = uploadPromiseRef.current;
    const capturedBase64 = pendingBase64Ref.current;
    uploadPromiseRef.current = null;
    pendingBase64Ref.current = null;

    // If an image was attached, await the background upload (started the
    // moment the image was scanned — well before this save press) before
    // firing the mutation. For entries with no image the promise is null so
    // the mutation fires synchronously in the same microtask.
    void (async () => {
      let objectPath: string | undefined;
      let uploadFailed = false;

      if (pendingUpload) {
        const result = await pendingUpload;
        if (result.ok) {
          objectPath = result.objectPath;
        } else {
          uploadFailed = true;
          // Inform the user — the entry will still be saved, just without
          // the photo attached. The image will be retried automatically when
          // connectivity is restored.
          if (result.reason === 'url-request-failed') {
            toast.warning('বিল ছবি সংযুক্ত হয়নি', {
              description: 'সংযোগ না থাকায় ছবিটি এখন আপলোড হয়নি। ইন্টারনেট ফিরলে স্বয়ংক্রিয়ভাবে যোগ হবে।',
              duration: 6000,
            });
          } else {
            toast.warning('বিল ছবি আপলোড ব্যর্থ হয়েছে', {
              description: 'নেটওয়ার্ক সমস্যার কারণে ছবিটি সংরক্ষণ করা যায়নি। ইন্টারনেট ফিরলে স্বয়ংক্রিয়ভাবে চেষ্টা হবে।',
              duration: 6000,
            });
          }
        }
      }

      try {
        const entry = await createEntry.mutateAsync({
          partyId,
          data: {
            type,
            amount: finalAmount,
            description,
            billReference: undefined,
            // Store the objectPath (e.g. "/objects/uploads/uuid") returned by
            // cloud storage, NOT the local base64 data URL.
            billImage: objectPath,
            dueDate: dueDate || undefined,
            isTransfer: isTransferMode || undefined,
            transferPartyId: isTransferMode ? transferPartyId : undefined,
          },
        });

        // If the upload failed but we have the base64 data and a real entry ID,
        // persist a retry record so the background service can re-attempt the
        // upload the next time connectivity is restored.
        if (uploadFailed && capturedBase64 && entry?.id) {
          savePendingUpload({ entryId: entry.id, partyId, base64: capturedBase64 });
        }
      } catch {
        // The mutation failed — optimistic rollback is handled by onError above.
        // Do not save a pending upload record since the entry itself wasn't created.
      }
    })();
  }, [memoryHistory.length, memoryValue, expression, createEntry, partyId, type, description, dueDate, clearMemory, onClose, isTransferMode, transferPartyId]);

  return (
    <div className="absolute inset-0 z-50 bg-[#f8fafc] flex flex-col">
      {/* Contextual header */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-[calc(0.75rem+var(--safe-top))] bg-white border-b border-slate-100 shrink-0">
        <button
          type="button"
          onClick={isEditMode && isDirty ? () => setShowExitConfirm(true) : onClose}
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
              {bigDisplayText ?? formatCurrency(0)}
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
            showMetadata ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
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

            {/* Transfer / adjustment toggle — create mode only */}
            {!isEditMode && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Toggle row */}
                <button
                  type="button"
                  tabIndex={showMetadata ? 0 : -1}
                  onClick={() => {
                    setIsTransferMode((v) => !v);
                    setTransferPartyId(null);
                    setTransferSearch('');
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 active:bg-slate-50 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <ArrowLeftRight className="w-4 h-4 text-blue-500 shrink-0" />
                    অন্য কাস্টমারের সাথে অ্যাডজাস্ট করুন
                  </span>
                  <div className={cn(
                    'w-10 h-6 rounded-full shrink-0 transition-colors duration-200 flex items-center px-0.5',
                    isTransferMode ? 'bg-blue-500' : 'bg-slate-300',
                  )}>
                    <div className={cn(
                      'w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
                      isTransferMode ? 'translate-x-4' : 'translate-x-0',
                    )} />
                  </div>
                </button>

                {/* Party search + list — only when toggle is on */}
                {isTransferMode && (
                  <div className="px-3 pb-3 border-t border-slate-100">
                    <input
                      value={transferSearch}
                      onChange={(e) => setTransferSearch(e.target.value)}
                      placeholder="কার সাথে অ্যাডজাস্ট হবে?"
                      tabIndex={showMetadata ? 0 : -1}
                      className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 mt-2.5 mb-2"
                    />
                    <div className="max-h-[108px] overflow-y-auto space-y-1">
                      {transferPartyOptions.length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-2">কোনো কাস্টমার পাওয়া যায়নি</p>
                      )}
                      {transferPartyOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          tabIndex={showMetadata ? 0 : -1}
                          onClick={() => setTransferPartyId(p.id)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
                            transferPartyId === p.id
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-50 text-slate-700 active:bg-slate-100',
                          )}
                        >
                          <span className="flex-1 truncate">{p.name}</span>
                          {p.phone && (
                            <span className={cn('text-xs shrink-0', transferPartyId === p.id ? 'text-blue-100' : 'text-slate-400')}>
                              {p.phone}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
          onClick={isEditMode ? handleUpdate : handleSave}
          disabled={!isActive}
          className={cn(
            'w-full h-14 rounded-xl font-extrabold text-white text-base shadow-[0_4px_14px_0_rgba(0,0,0,0.15)] active:scale-[0.98] transition-all disabled:opacity-40 disabled:active:scale-100',
            isGet ? 'bg-emerald-600' : 'bg-red-500'
          )}
        >
          {isEditMode ? 'সংরক্ষণ করুন' : 'এন্ট্রি নিশ্চিত করুন'}
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

      {/* ── Exit confirmation (edit mode only) ─────────────────────────
          Shown when the user presses ← with unsaved edits. Choosing
          "হ্যাঁ" fires handleUpdate (save + close); "না" discards and
          closes. Dismissing the dialog (tap outside / Escape) returns
          the user to the edit form so they can keep working.           */}
      {isEditMode && (
        <AlertDialog open={showExitConfirm} onOpenChange={setShowExitConfirm}>
          <AlertDialogContent className="max-w-sm rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-800">
                পরিবর্তন সংরক্ষণ করবেন?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-600">
                আপনি কি পরিবর্তনগুলো সংরক্ষণ করতে চান? না করলে এডিট বাতিল হবে।
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* "না" — discard edits and exit */}
              <AlertDialogCancel
                className="font-bold"
                onClick={onClose}
              >
                না, বাতিল করুন
              </AlertDialogCancel>
              {/* "হ্যাঁ" — save then exit */}
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  handleUpdate();
                }}
                className={cn(
                  'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-bold text-white transition-colors',
                  isGet ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600',
                )}
              >
                হ্যাঁ, সংরক্ষণ করুন
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
