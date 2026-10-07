import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
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
  createLedgerEntry,
  useListParties,
  useListAdjustmentTargets,
  getListAdjustmentTargetsQueryKey,
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
import { cn, evaluateCalculatorExpression, formatCurrency, formatExpressionForDisplay, toBengaliDigits, trimNumberForExpression } from '@/lib/utils';
import { playCalculatorTapSound } from '@/lib/calculator-sound';
import { applyBalanceDelta, shiftSummaryForPartyChange } from '@/lib/optimistic';
import { CameraCaptureModal } from '@/components/modals/camera-capture-modal';
import { scanDocument } from '@/lib/document-scan';
import { useAppAuth } from '@/App';
import { uploadBillImage, billImageSrc, type BillImageUploadResult } from '@/lib/billImageStorage';
import { savePendingUpload } from '@/lib/pendingUploads';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import { useConnectionState } from '@/context/connection-state';
import { notifyEntrySaved } from '@/components/ui/entry-saved-feedback';
import { queueEntry } from '@/lib/entryOutbox';
import { isTransientNetworkError } from '@/lib/offlineErrors';
import { readOfflineIdentity } from '@/lib/offlineSession';

type KeyKind = 'digit' | 'muted' | 'accent';
type KeyDef = { label: string; value: string; kind: KeyKind; span?: number };
type TextSelection = { start: number; end: number };

function normalizeCalculatorInput(raw: string): string {
  return raw
    .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
    .replace(/[×]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−]/g, '-')
    .replace(/[^0-9.+\-*/%]/g, '');
}

function isCalculatorOperator(value: string | undefined): boolean {
  return value === '+' || value === '-' || value === '*' || value === '/';
}

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
      data-testid={`calculator-key-${def.value}`}
      onClick={() => {
        playCalculatorTapSound();
        onPress(def.value);
      }}
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
  partyRole,
  type,
  onClose,
  initialEntry,
}: {
  partyId: string;
  partyName: string;
  partyRole: Party['role'];
  type: LedgerEntryType;
  onClose: () => void;
  /** When provided the screen opens in edit mode, pre-populated with the
   *  existing entry's data. Saving issues a PATCH instead of a POST. */
  initialEntry?: LedgerEntry;
}) {
  const isEditMode = !!initialEntry;
  const { role: userRole, adjustmentPartyIds, userId } = useAppAuth();
  const { selectedBusinessId } = useBusinessContext();
  const { isOnline } = useConnectionState();
  const canAdjustSource = userRole === 'owner' || adjustmentPartyIds.includes(partyId);
  const partyRoleLabel = partyRole === 'SUPPLIER' ? 'সরবরাহকারী' : 'কাস্টমার';
  const partyRoleSearchLabel = partyRole === 'SUPPLIER' ? 'সরবরাহকারীর' : 'কাস্টমারের';
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  /** Stores the cloud-storage path of the bill image already on the entry so
   *  handleUpdate can keep it unchanged when the user hasn't replaced it. */
  const originalBillImagePathRef = useRef<string | null>(initialEntry?.billImage ?? null);
  const queryClient = useQueryClient();
  // New entries are committed to IndexedDB before the form closes. They
  // remain visibly pending and never affect the confirmed server balance
  // until the outbox receives acknowledgement and refetches the ledger.

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
  // Mirrors `expression` so keypad handlers can synchronously insert at the
  // current caret without stale state or side effects inside a state updater.
  const expressionRef = useRef('');
  const amountInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const pendingSelectionRef = useRef<TextSelection | null>(null);
  const setExpressionAtSelection = useCallback((next: string, selection: TextSelection) => {
    const clamped = {
      start: Math.max(0, Math.min(selection.start, next.length)),
      end: Math.max(0, Math.min(selection.end, next.length)),
    };
    expressionRef.current = next;
    selectionRef.current = clamped;
    pendingSelectionRef.current = clamped;
    setExpression(next);
  }, []);
  useLayoutEffect(() => {
    expressionRef.current = expression;
    const pending = pendingSelectionRef.current;
    const input = amountInputRef.current;
    if (pending && input) {
      input.setSelectionRange(pending.start, pending.end);
      selectionRef.current = pending;
      pendingSelectionRef.current = null;
    }
  }, [expression]);
  const captureAmountSelection = useCallback((event: SyntheticEvent<HTMLInputElement>) => {
    const { selectionStart, selectionEnd } = event.currentTarget;
    const end = selectionEnd ?? expressionRef.current.length;
    selectionRef.current = {
      start: selectionStart ?? end,
      end,
    };
  }, []);
  const handleAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    const rawStart = event.currentTarget.selectionStart ?? raw.length;
    const rawEnd = event.currentTarget.selectionEnd ?? rawStart;
    const next = normalizeCalculatorInput(raw);
    const start = normalizeCalculatorInput(raw.slice(0, rawStart)).length;
    const end = normalizeCalculatorInput(raw.slice(0, rawEnd)).length;
    setShowError(false);
    setLastFormulaText('');
    setHasInteracted(true);
    justRecalledRef.current = false;
    setExpressionAtSelection(next, { start, end });
  }, [setExpressionAtSelection]);
  const handleMrcTap = useCallback(() => {
    if (justRecalledRef.current) {
      clearMemory();
      justRecalledRef.current = false;
      return;
    }
    const recalled = trimNumberForExpression(memoryValueRef.current);
    setExpressionAtSelection(recalled, { start: recalled.length, end: recalled.length });
    setHasInteracted(true);
    justRecalledRef.current = true;
  }, [clearMemory, setExpressionAtSelection]);
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
  // Used to upload a bill image before submitting a new entry online.
  const pendingBase64Ref = useRef<string | null>(null);
  const uploadedCreateImageRef = useRef<{ source: string; objectPath: string } | null>(null);
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

  // ── Transfer / adjustment state ──────────────────────────────────────────
  const [isTransferMode, setIsTransferMode] = useState(() => Boolean(initialEntry?.isTransfer));
  const [transferPartyId, setTransferPartyId] = useState<string | null>(
    () => initialEntry?.transferPartyId ?? null,
  );
  const [transferSearch, setTransferSearch] = useState('');

  // Fetch party list for the transfer dropdown (only when toggle is on).
  const adjustmentTargetParams = { partyRole };
  const { data: transferPartyList = [] } = useListAdjustmentTargets(
    adjustmentTargetParams,
    {
      query: {
        enabled: canAdjustSource && isTransferMode,
        queryKey: businessScopedQueryKey(
          getListAdjustmentTargetsQueryKey(adjustmentTargetParams),
          selectedBusinessId,
        ),
      },
    },
  );
  const transferPartyOptions = transferPartyList.filter((p) => p.id !== partyId &&
    p.role === partyRole &&
    p.name.toLocaleLowerCase().includes(transferSearch.trim().toLocaleLowerCase()));

  // Controls the "unsaved changes" confirmation dialog shown when the user
  // presses back with a dirty edit-mode form.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);

  const handleToggleAdjustment = useCallback(() => {
    if (isEditMode && initialEntry?.isTransfer && isTransferMode) {
      setShowUnlinkConfirm(true);
      return;
    }
    setIsTransferMode((current) => !current);
    setTransferPartyId(null);
    setTransferSearch('');
  }, [isEditMode, initialEntry, isTransferMode]);

  const confirmUnlinkAdjustment = useCallback(() => {
    setIsTransferMode(false);
    setTransferPartyId(null);
    setTransferSearch('');
    setShowUnlinkConfirm(false);
  }, []);

  const isGet = type === LedgerEntryType.YOU_GOT;
  const hasFormula = /[+\-*/%]/.test(expression.replace(/^-/, ''));

  const liveResult = useMemo(() => {
    if (!expression) return 0;
    return evaluateCalculatorExpression(expression) ?? 0;
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

    // Adjustment state and the selected counterparty are editable too.
    if (isTransferMode !== Boolean(initialEntry.isTransfer)) return true;
    if (isTransferMode && transferPartyId !== (initialEntry.transferPartyId ?? null)) return true;

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
    description, dueDate, billImage, isTransferMode, transferPartyId,
  ]);

  // The authoritative amount used for saving and the header title — always
  // the fully-evaluated expression result, or the memory total.
  const displayAmount = memoryHistory.length > 0 ? memoryValue : (liveResult ?? 0);

  // isActive: true whenever there's something meaningful to save
  const isActive = memoryHistory.length > 0 ? memoryValue !== 0 : expression.length > 0;
  // Whether the metadata panel should be shown — persistent once triggered,
  // unlike `isActive` which can flip back off as the formula is edited.
  const showMetadata = hasInteracted;

  const processCapturedImage = useCallback(async (dataUrl: string) => {
    uploadedCreateImageRef.current = null;
    setIsScanning(true);
    try {
      const scanned = await scanDocument(dataUrl);
      // Show the scanned image as a local thumbnail immediately.
      setBillImage(scanned);
      // New entries persist the image with their draft; upload only during
      // replay so a background pre-upload cannot orphan a duplicate object.
      pendingBase64Ref.current = scanned;
      uploadPromiseRef.current = isEditMode ? uploadBillImage(scanned) : null;
    } catch (err) {
      // Falls back to the raw captured photo rather than blocking the user
      // with an error toast — they can still attach it or retake it.
      console.error('বিল স্ক্যান করা যায়নি, মূল ছবি ব্যবহার করা হচ্ছে:', err);
      setBillImage(dataUrl);
      pendingBase64Ref.current = dataUrl;
      uploadPromiseRef.current = isEditMode ? uploadBillImage(dataUrl) : null;
    } finally {
      setIsScanning(false);
    }
  }, [isEditMode]);

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

  // Stable across renders so the memoized key grid doesn't re-render while
  // the user edits the expression or moves the cursor.
  const pressKey = useCallback((value: string) => {
    setShowError(false);
    // Any keypad press other than the MRC bar breaks the recall→clear combo.
    justRecalledRef.current = false;
    const current = expressionRef.current;
    const start = Math.max(0, Math.min(selectionRef.current.start, current.length));
    const end = Math.max(start, Math.min(selectionRef.current.end, current.length));
    if (value === 'C') {
      setLastFormulaText('');
      setExpressionAtSelection('', { start: 0, end: 0 });
      return;
    }
    if (value === 'DEL') {
      if (start !== end) {
        setLastFormulaText('');
        setExpressionAtSelection(current.slice(0, start) + current.slice(end), { start, end: start });
      } else if (start > 0) {
        const caret = start - 1;
        setLastFormulaText('');
        setExpressionAtSelection(current.slice(0, caret) + current.slice(end), { start: caret, end: caret });
      }
      return;
    }
    if (value === '=') {
      const result = evaluateCalculatorExpression(current);
      if (result === null) {
        setShowError(true);
        return;
      }
      // Save the formula so sub-bar keeps showing "500×100 = 50000" after =
      const formulaDisplay = formatExpressionForDisplay(current);
      setLastFormulaText(`${formulaDisplay} = ${trimNumberForExpression(result)}`);
      const resolved = trimNumberForExpression(result);
      setExpressionAtSelection(resolved, { start: resolved.length, end: resolved.length });
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
      const currentExpression = current;
      const result = currentExpression ? evaluateCalculatorExpression(currentExpression) : 0;
      const safeValue = result !== null && Number.isFinite(result) ? result : 0;
      const label = currentExpression ? formatExpressionForDisplay(currentExpression) : '0';
      const newMemoryValue = value === 'M+' ? memoryValueRef.current + safeValue : memoryValueRef.current - safeValue;
      memoryValueRef.current = newMemoryValue;
      setMemoryValue(newMemoryValue);
      setMemoryHistory((prev) => [...prev, `${value}(${label})=${newMemoryValue.toFixed(1)}`]);
      // Clear the typed expression so the next number starts fresh for the
      // following memory entry.
      setExpressionAtSelection('', { start: 0, end: 0 });
      justRecalledRef.current = false;
      // Silent by design: no toast/alert here — the running total and
      // history list already update instantly, so a notification would
      // just interrupt fast, repeated M+/M- entry.
      return;
    }
    if (value === '.') {
      setHasInteracted(true);
      let operandStart = start;
      while (operandStart > 0 && !isCalculatorOperator(current[operandStart - 1])) operandStart--;
      let operandEnd = end;
      while (operandEnd < current.length && !isCalculatorOperator(current[operandEnd])) operandEnd++;
      const operandWithoutSelection = current.slice(operandStart, start) + current.slice(end, operandEnd);
      if (operandWithoutSelection.includes('.')) return;
      const insertion = operandWithoutSelection ? '.' : '0.';
      const next = current.slice(0, start) + insertion + current.slice(end);
      setExpressionAtSelection(next, { start: start + insertion.length, end: start + insertion.length });
      return;
    }

    // Insert at the current cursor or replace the selected text.
    setHasInteracted(true);
    let replaceStart = start;
    let replaceEnd = end;
    if (isCalculatorOperator(value) && start === end && start > 0 && isCalculatorOperator(current[start - 1])) {
      replaceStart = start - 1;
      replaceEnd = start;
    }
    const next = current.slice(0, replaceStart) + value + current.slice(replaceEnd);
    const caret = replaceStart + value.length;
    setExpressionAtSelection(next, { start: caret, end: caret });
  }, [setExpressionAtSelection]);

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
    if (!navigator.onLine || !isOnline) {
      toast.error('অফলাইনে এন্ট্রি পরিবর্তন করা যায় না', { description: 'ইন্টারনেট ফিরে এলে আবার চেষ্টা করুন। আপনার লেখা ফর্মে আছে।' });
      return;
    }

    const finalAmount =
      memoryHistory.length > 0
        ? memoryValue
        : evaluateCalculatorExpression(expression);
    if (finalAmount === null || finalAmount <= 0) {
      setShowError(true);
      return;
    }

    const selectedTransferParty = transferPartyList.find((p) => p.id === transferPartyId);
    if (isTransferMode && (
      !canAdjustSource ||
      !transferPartyId ||
      selectedTransferParty?.role !== partyRole ||
      (userRole !== 'owner' && !adjustmentPartyIds.includes(transferPartyId))
    )) {
      toast.warning(`${partyRoleLabel} বেছে নিন`, {
        description: 'অ্যাডজাস্টমেন্ট সংরক্ষণ করতে একই ধরনের অন্য একটি পক্ষ বেছে নিন।',
      });
      return;
    }

    const entriesKey = businessScopedQueryKey(getListLedgerEntriesQueryKey(partyId), selectedBusinessId);
    const partyKey   = businessScopedQueryKey(getGetPartyQueryKey(partyId), selectedBusinessId);
    const partiesKey = businessScopedQueryKey(getListPartiesQueryKey(), selectedBusinessId);
    const summaryKey = businessScopedQueryKey(getGetDashboardSummaryQueryKey(), selectedBusinessId);
    const affectedPartyIds = new Set([
      partyId,
      initialEntry.isTransfer ? initialEntry.transferPartyId : null,
      isTransferMode ? transferPartyId : null,
    ].filter((id): id is string => Boolean(id)));

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
      isTransfer: isTransferMode,
      transferPartyId: isTransferMode ? transferPartyId : null,
      linkedEntryId: isTransferMode ? (initialEntry.linkedEntryId ?? null) : null,
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
            savePendingUpload({
              entryId: initialEntry.id,
              partyId,
              businessId: selectedBusinessId,
              base64: capturedBase64,
            });
          }
        }
      }

      try {
        const res = await fetch(
          `${BASE}/api/parties/${partyId}/ledger-entries/${initialEntry.id}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(selectedBusinessId ? { 'X-Business-Id': selectedBusinessId } : {}),
            },
            body: JSON.stringify({
              amount:      finalAmount,
              type,
              description,
              dueDate:     dueDate || undefined,
              isTransfer: isTransferMode,
              transferPartyId: isTransferMode ? transferPartyId : null,
              ...(billImageChanged ? { billImage: objectPath } : {}),
            }),
          },
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.error('[PATCH] server error body:', JSON.stringify(errBody));
          throw new Error(`HTTP ${res.status}: ${JSON.stringify(errBody)}`);
        }
        const savedEntry = await res.json() as LedgerEntry;
        queryClient.setQueryData<LedgerEntry[]>(entriesKey, (old) =>
          (old ?? []).map((entry) =>
            entry.id === savedEntry.id ? { ...updatedEntry, ...savedEntry } : entry,
          ),
        );

        // ── 5. Background reconciliation ──────────────────────────────────
        for (const affectedPartyId of affectedPartyIds) {
          queryClient.invalidateQueries({
            queryKey: businessScopedQueryKey(getListLedgerEntriesQueryKey(affectedPartyId), selectedBusinessId),
          });
          queryClient.invalidateQueries({
            queryKey: businessScopedQueryKey(getGetPartyQueryKey(affectedPartyId), selectedBusinessId),
          });
        }
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
    queryClient, clearMemory, onClose, BASE, isOnline, selectedBusinessId,
    isTransferMode, transferPartyId, transferPartyList, canAdjustSource,
    partyRole, partyRoleLabel, userRole, adjustmentPartyIds,
  ]);

  const savingRef = useRef(false);
  const createRequestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
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
    const selectedTransferParty = transferPartyList.find((party) => party.id === transferPartyId);
    if (isTransferMode && (
      !canAdjustSource ||
      !transferPartyId ||
      selectedTransferParty?.role !== partyRole ||
      (userRole !== 'owner' && !adjustmentPartyIds.includes(transferPartyId))
    )) {
      toast.warning(`${partyRoleLabel} বেছে নিন`, {
        description: `অ্যাডজাস্টমেন্টের জন্য একজন ${partyRoleLabel} নির্বাচন করুন।`,
        duration: 3000,
      });
      return;
    }

    if (!userId) {
      toast.error('পরিচয় যাচাই করা যায়নি। আবার লগইন করুন।');
      return;
    }
    const capturedBase64 = pendingBase64Ref.current;
    savingRef.current = true;
    try {
      let billImage: string | undefined;
      let uploadUnavailable = false;
      if (capturedBase64 && navigator.onLine) {
        const cachedUpload = uploadedCreateImageRef.current;
        if (cachedUpload?.source === capturedBase64) {
          billImage = cachedUpload.objectPath;
        } else {
          const uploaded = await uploadBillImage(capturedBase64);
          if (!uploaded.ok) {
            uploadUnavailable = true;
          } else {
            billImage = uploaded.objectPath;
            uploadedCreateImageRef.current = { source: capturedBase64, objectPath: uploaded.objectPath };
          }
        }
      }

      const data = {
        type,
        amount: finalAmount,
        description,
        dueDate: dueDate || undefined,
        isTransfer: isTransferMode || undefined,
        transferPartyId: isTransferMode ? transferPartyId : undefined,
        ...(billImage ? { billImage } : {}),
      };
      const fingerprint = JSON.stringify([partyId, selectedBusinessId, data]);
      const requestId = createRequestRef.current?.fingerprint === fingerprint
        ? createRequestRef.current.id
        : crypto.randomUUID();
      createRequestRef.current = { fingerprint, id: requestId };

      const requestData = {
        ...data,
        clientRequestId: requestId,
      };
      const savedIdentity = readOfflineIdentity();
      const activeBusinessId = selectedBusinessId ?? savedIdentity?.businessId ?? null;
      const saveOfflineDraft = async () => {
        const actorId = userId ?? savedIdentity?.userId;
        const businessId = activeBusinessId;
        if (!actorId || !businessId) throw new Error('পরিচয় বা ব্যবসার তথ্য পাওয়া যায়নি');
        await queueEntry({
          id: requestId,
          actorId,
          businessId,
          partyId,
          data: requestData,
          ...(capturedBase64 && !billImage ? { imageBase64: capturedBase64 } : {}),
          createdAt: new Date().toISOString(),
          status: 'pending',
        });
        toast.success('হিসাবটি ডিভাইসে সেভ হয়েছে; সংযোগ ফিরলে সিঙ্ক হবে');
      };

      if (!navigator.onLine || uploadUnavailable) {
        await saveOfflineDraft();
      } else {
        try {
          await createLedgerEntry(partyId, requestData, {
            headers: { 'x-business-id': activeBusinessId ?? '' },
          });
        } catch (error) {
          if (!isTransientNetworkError(error)) throw error;
          await saveOfflineDraft();
        }
      }

      queryClient.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
      queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
      queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      createRequestRef.current = null;
      uploadedCreateImageRef.current = null;
      pendingBase64Ref.current = null;
      clearMemory();
      notifyEntrySaved();
      onClose();
    } catch (error) {
      console.error('Online ledger entry save failed:', error);
      toast.error('সার্ভারে হিসাব জমা হয়নি', {
        description: 'সংযোগ পরীক্ষা করে এই ফর্ম থেকে আবার চেষ্টা করুন। এন্ট্রি সংরক্ষিত হয়নি।',
      });
    } finally {
      savingRef.current = false;
    }
  }, [memoryHistory.length, memoryValue, expression, partyId, partyRole, partyRoleLabel, transferPartyList, type, description, dueDate, clearMemory, onClose, isTransferMode, transferPartyId, canAdjustSource, userRole, adjustmentPartyIds, userId, selectedBusinessId, queryClient]);

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
          <div className="px-4 py-3 flex items-center gap-3">
            <span aria-hidden="true" className={cn('text-2xl font-extrabold tracking-tight', isGet ? 'text-emerald-600' : 'text-red-500')}>
              ৳
            </span>
            <input
              ref={amountInputRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="পরিমাণ লিখুন"
              data-testid="input-transaction-amount"
              value={toBengaliDigits(formatExpressionForDisplay(expression).replace(/-/g, '−'))}
              onChange={handleAmountChange}
              onSelect={captureAmountSelection}
              onClick={captureAmountSelection}
              onKeyUp={captureAmountSelection}
              onBlur={captureAmountSelection}
              placeholder="পরিমাণ লিখুন"
              className={cn(
                'min-w-0 flex-1 bg-transparent text-left text-2xl font-extrabold tracking-tight tabular-nums placeholder:text-slate-300 focus:outline-none',
                isGet ? 'text-emerald-600' : 'text-red-500',
              )}
            />
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
              <p data-testid="calculator-live-display" className="text-sm font-mono font-medium text-slate-500 truncate">
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

      {/* ── Toolbar: date · bill · adjustment — shown after first key press ─── */}
      {showMetadata && (
      <div className="px-3 pb-2 shrink-0 space-y-2">
        {/* Row 1: date + bill */}
        <div className={cn("grid gap-2", userRole === 'owner' ? "grid-cols-2" : "grid-cols-1")}>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-11 px-3 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {userRole === 'owner' && (
            billImage ? (
              <div className="h-11 flex items-center justify-end gap-2">
                <div className="relative h-11 w-11 shrink-0">
                  <img src={billImage} alt="সংযুক্ত বিল" className="w-full h-full rounded-xl object-cover border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => {
                      setBillImage(null);
                      pendingBase64Ref.current = null;
                      uploadedCreateImageRef.current = null;
                      uploadPromiseRef.current = null;
                    }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm active:scale-90 transition-transform"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleAttachClick}
                  className="h-11 flex-1 rounded-xl bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-transform"
                >
                  <Camera className="w-4 h-4" /> পরিবর্তন
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleAttachClick}
                className="h-11 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-600 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Camera className="w-4 h-4" /> বিল সংযুক্ত করুন
              </button>
            )
          )}
        </div>

        {isEditMode && initialEntry?.isTransfer && !canAdjustSource && (
          <div
            data-testid="edit-adjustment-readonly"
            role="note"
            className="min-h-11 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 flex items-center gap-2"
          >
            <ArrowLeftRight className="w-4 h-4 text-blue-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-blue-900 truncate">
                অ্যাডজাস্টমেন্ট
              </p>
              <p className="text-[10px] leading-4 font-medium text-blue-800">
                আপনার এই লেনদেনের অ্যাডজাস্টমেন্ট পরিবর্তনের অনুমতি নেই।
              </p>
            </div>
          </div>
        )}

        {/* Row 2: adjustment toggle — available for both new and existing entries */}
        {canAdjustSource && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Compact toggle row */}
            <button
              type="button"
              data-testid="button-toggle-adjustment"
              onClick={handleToggleAdjustment}
              className="w-full h-11 flex items-center justify-between px-4 active:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 min-w-0">
                <ArrowLeftRight className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="truncate">
                  {isTransferMode && transferPartyId
                    ? `⇄ ${transferPartyOptions.find(p => p.id === transferPartyId)?.name ?? 'নির্বাচিত'}`
                    : 'অ্যাডজাস্টমেন্ট'}
                </span>
              </span>
              {/* Toggle pill */}
              <div className={cn(
                'w-10 h-6 rounded-full shrink-0 ml-3 transition-colors duration-200 flex items-center px-0.5',
                isTransferMode ? 'bg-blue-500' : 'bg-slate-300',
              )}>
                <div className={cn(
                  'w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
                  isTransferMode ? 'translate-x-4' : 'translate-x-0',
                )} />
              </div>
            </button>

            {/* Counterparties of the source party's role — only when toggle is ON */}
            {isTransferMode && (
              <div className="border-t border-slate-100 px-3 pb-3">
                <p className="pt-2 text-[10px] font-medium text-blue-700">
                  সংরক্ষণ করলে দুই পক্ষের খাতা একসাথে আপডেট হবে।
                </p>
                <input
                  value={transferSearch}
                  data-testid="input-adjustment-party-search"
                  onChange={(e) => setTransferSearch(e.target.value)}
                  placeholder={`${partyRoleSearchLabel} নাম লিখুন…`}
                  autoFocus
                  className="w-full h-9 px-3 mt-2.5 mb-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                />
                <div className="max-h-[120px] overflow-y-auto space-y-1">
                  {transferPartyOptions.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-2">কোনো {partyRoleLabel} পাওয়া যায়নি</p>
                  )}
                  {transferPartyOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`button-adjustment-party-${p.id}`}
                      onClick={() => setTransferPartyId(p.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors',
                        transferPartyId === p.id ? 'bg-blue-500 text-white' : 'bg-slate-50 text-slate-700 active:bg-slate-100',
                      )}
                    >
                      <span className="flex-1 truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
            onClick={() => {
              playCalculatorTapSound();
              handleMrcTap();
            }}
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
      {isEditMode && initialEntry?.isTransfer && (
        <AlertDialog open={showUnlinkConfirm} onOpenChange={setShowUnlinkConfirm}>
          <AlertDialogContent className="max-w-sm rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-800">
                অ্যাডজাস্টমেন্ট লিংক সরাবেন?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-slate-600">
                লিংক সরালে অন্য পক্ষের খাতা থেকে মিলানো এন্ট্রিটি মুছে যাবে এবং দুই পক্ষের বাকি হিসাব আপডেট হবে।
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-bold">
                না, লিংক রাখুন
              </AlertDialogCancel>
              <button
                type="button"
                onClick={confirmUnlinkAdjustment}
                className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700"
              >
                হ্যাঁ, লিংক সরান
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
