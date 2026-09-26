/**
 * BengaliLedgerScanner
 *
 * Full-screen modal that lets the user scan a handwritten Bengali ledger image
 * (camera shot or gallery file), reviews AI-matched party names and amounts,
 * then bulk-saves all confirmed entries in a single API call.
 */
import { useRef, useState } from 'react';
import { X, Camera, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';
import {
  useScanBengaliLedger,
  useBulkSaveBengaliLedger,
  useListParties,
  type BengaliLedgerItem,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// ── types ──────────────────────────────────────────────────────────────────────
interface ReviewItem extends BengaliLedgerItem {
  _id: string;
  enabled: boolean;
  editAmount: string;
  editType: 'YOU_GAVE' | 'YOU_GOT';
  editNote: string;
  /** partyId after user optionally re-selects from dropdown */
  resolvedPartyId: string | null;
  resolvedPartyName: string;
}

type Step = 'pick' | 'scanning' | 'review' | 'saving';

interface Props {
  onClose: () => void;
  onSuccess?: () => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────
const confidenceLabel = (c: string) =>
  c === 'high' ? { label: 'উচ্চ', color: 'text-emerald-600 bg-emerald-50' }
  : c === 'medium' ? { label: 'মধ্যম', color: 'text-amber-600 bg-amber-50' }
  : { label: 'কম', color: 'text-red-500 bg-red-50' };

// ── component ─────────────────────────────────────────────────────────────────
export function BengaliLedgerScanner({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('pick');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const scanMutation = useScanBengaliLedger();
  const bulkSaveMutation = useBulkSaveBengaliLedger();
  const qc = useQueryClient();

  // Load all parties so we can offer a re-assign dropdown for unmatched items
  const { data: allParties = [] } = useListParties({});

  // ── image processing ──────────────────────────────────────────────────────
  async function processFile(file: File) {
    setError(null);
    setPreviewUrl(URL.createObjectURL(file));
    setStep('scanning');

    try {
      const result = await scanMutation.mutateAsync({ data: { image: file } });

      if (!result.items || result.items.length === 0) {
        setError('ছবিতে কোনো লেনদেন পাওয়া যায়নি। স্পষ্ট আলোতে পুনরায় চেষ্টা করুন।');
        setStep('pick');
        return;
      }

      setItems(
        result.items.map((item, i) => ({
          ...item,
          _id: String(i),
          enabled: true,
          editAmount: String(item.amount),
          editType: item.type as 'YOU_GAVE' | 'YOU_GOT',
          editNote: item.note ?? '',
          resolvedPartyId: item.partyId,
          resolvedPartyName: item.partyName,
        })),
      );
      setStep('review');
    } catch {
      setError('স্ক্যান করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
      setStep('pick');
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }

  // ── item editing helpers ──────────────────────────────────────────────────
  function toggle(id: string) {
    setItems((prev) => prev.map((i) => (i._id === id ? { ...i, enabled: !i.enabled } : i)));
  }
  function updateField<K extends keyof ReviewItem>(id: string, field: K, value: ReviewItem[K]) {
    setItems((prev) => prev.map((i) => (i._id === id ? { ...i, [field]: value } : i)));
  }
  function reassignParty(id: string, partyId: string) {
    const p = allParties.find((x) => x.id === partyId);
    if (!p) return;
    setItems((prev) =>
      prev.map((i) =>
        i._id === id ? { ...i, resolvedPartyId: p.id, resolvedPartyName: p.name } : i,
      ),
    );
  }

  // ── confirm & save ────────────────────────────────────────────────────────
  async function handleConfirm() {
    const toSave = items.filter(
      (i) => i.enabled && Number(i.editAmount) > 0 && i.resolvedPartyId,
    );
    if (toSave.length === 0) {
      toast.error('সেভ করার জন্য কমপক্ষে একটি সম্পূর্ণ এন্ট্রি নির্বাচন করুন।');
      return;
    }

    setStep('saving');
    try {
      const result = await bulkSaveMutation.mutateAsync({
        data: {
          entries: toSave.map((i) => ({
            partyId: i.resolvedPartyId!,
            amount: Number(i.editAmount),
            type: i.editType,
            note: i.editNote,
          })),
        },
      });

      await qc.invalidateQueries({ queryKey: ['/api/parties'] });
      await qc.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
      onSuccess?.();
      toast.success(`${result.count}টি হিসাব সফলভাবে সেভ হয়েছে!`);
      onClose();
    } catch {
      toast.error('সেভ করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
      setStep('review');
    }
  }

  const enabledCount = items.filter(
    (i) => i.enabled && Number(i.editAmount) > 0 && i.resolvedPartyId,
  ).length;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ── header ── */}
      <div className="shrink-0 bg-[#1B3A6B] text-white flex items-center gap-3 px-4 py-4 pt-[calc(1rem+var(--safe-top))]">
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/15 transition-all"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-[15px]">বাংলা খাতা স্ক্যান</h2>
          <p className="text-white/60 text-[11px]">হাতে লেখা খাতা থেকে হিসাব তুলুন</p>
        </div>
        {step === 'review' && (
          <button
            type="button"
            onClick={() => { setStep('pick'); setPreviewUrl(null); setItems([]); }}
            className="text-white/70 text-[12px] font-semibold hover:text-white transition-colors"
          >
            নতুন ছবি
          </button>
        )}
      </div>

      {/* ── hidden file inputs ── */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />

      {/* ── body ── */}
      <div className="flex-1 overflow-y-auto">
        {/* ── pick / scanning ── */}
        {(step === 'pick' || step === 'scanning') && (
          <div className="flex flex-col items-center px-6 pt-12 pb-8 gap-6">
            {previewUrl && step === 'scanning' && (
              <img
                src={previewUrl}
                alt="preview"
                className="w-full max-w-xs rounded-2xl object-cover shadow-md"
              />
            )}

            {step === 'scanning' ? (
              <div className="flex flex-col items-center gap-4 pt-4">
                <div className="w-16 h-16 rounded-full bg-[#1B3A6B]/8 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
                </div>
                <p className="font-semibold text-slate-700">AI বিশ্লেষণ করছে…</p>
                <p className="text-sm text-slate-400 text-center">হাতে লেখা নাম ও পরিমাণ খুঁজে বের করা হচ্ছে</p>
              </div>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-[#1B3A6B]/8 flex items-center justify-center">
                  <Camera className="w-9 h-9 text-[#1B3A6B]" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-bold text-slate-800">বাংলা খাতার ছবি তুলুন</h3>
                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                    হাতে লেখা খাতার ছবি তুলুন — AI সব নাম চিনে সংশ্লিষ্ট গ্রাহক/সরবরাহকারীর হিসাবে যোগ করবে।
                  </p>
                </div>

                {error && (
                  <div className="w-full flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl p-3.5">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-600 font-medium">{error}</p>
                  </div>
                )}

                <div className="w-full flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-3 bg-[#1B3A6B] text-white rounded-2xl py-4 font-bold text-[15px] hover:bg-[#1B3A6B]/90 active:scale-[0.98] transition-all"
                  >
                    <Camera className="w-5 h-5" />
                    ক্যামেরা দিয়ে ছবি তুলুন
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex items-center justify-center gap-3 border-2 border-[#1B3A6B] text-[#1B3A6B] rounded-2xl py-[14px] font-bold text-[15px] hover:bg-[#1B3A6B]/5 active:scale-[0.98] transition-all"
                  >
                    <ImageIcon className="w-5 h-5" />
                    গ্যালারি থেকে ছবি বেছে নিন
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── review ── */}
        {step === 'review' && (
          <div className="px-4 pt-4 pb-36 flex flex-col gap-3">
            {/* preview thumbnail */}
            {previewUrl && (
              <img
                src={previewUrl}
                alt="scanned ledger"
                className="w-full rounded-xl object-cover max-h-40 shadow-sm"
              />
            )}

            {/* summary bar */}
            <div className="flex items-center justify-between px-1">
              <p className="text-[13px] font-bold text-slate-700">{items.length}টি লেনদেন পাওয়া গেছে</p>
              <p className="text-[12px] text-slate-400">{enabledCount}টি নির্বাচিত</p>
            </div>

            {items.map((item) => {
              const conf = confidenceLabel(item.confidence);
              const hasParty = !!item.resolvedPartyId;
              return (
                <div
                  key={item._id}
                  className={`rounded-2xl border p-3.5 transition-all ${
                    item.enabled && hasParty
                      ? 'bg-white border-slate-200'
                      : item.enabled && !hasParty
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-slate-50 border-slate-100 opacity-50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* checkbox */}
                    <button
                      type="button"
                      onClick={() => toggle(item._id)}
                      className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                        item.enabled ? 'border-[#1B3A6B] bg-[#1B3A6B]' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {item.enabled && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </button>

                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      {/* party assignment */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-slate-400 font-medium">
                            চিহ্নিত নাম
                            <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${conf.color}`}>
                              {conf.label}
                            </span>
                          </p>
                          {hasParty ? (
                            <p className="font-bold text-slate-800 text-[14px] truncate">{item.resolvedPartyName}</p>
                          ) : (
                            <p className="font-medium text-amber-700 text-[13px] truncate">
                              ⚠️ "{item.extractedName}" — মেলেনি
                            </p>
                          )}
                          {item.extractedName && item.extractedName !== item.resolvedPartyName && (
                            <p className="text-[11px] text-slate-400">খাতায় লেখা: {item.extractedName}</p>
                          )}
                        </div>
                      </div>

                      {/* reassign dropdown (show when unmatched or always) */}
                      <div className="relative">
                        <select
                          value={item.resolvedPartyId ?? ''}
                          onChange={(e) => reassignParty(item._id, e.target.value)}
                          disabled={!item.enabled}
                          className="w-full appearance-none text-[12px] font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 pr-7 text-slate-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/20"
                        >
                          <option value="">— পার্টি পুনরায় বেছে নিন —</option>
                          {allParties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.role === 'CUSTOMER' ? 'গ্রাহক' : 'সরবরাহকারী'})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      </div>

                      {/* type toggle + amount */}
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 shrink-0">
                          <button
                            type="button"
                            disabled={!item.enabled}
                            onClick={() => updateField(item._id, 'editType', 'YOU_GAVE')}
                            className={`px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                              item.editType === 'YOU_GAVE'
                                ? 'bg-red-500 text-white'
                                : 'bg-white text-slate-400'
                            }`}
                          >
                            দিয়েছি
                          </button>
                          <button
                            type="button"
                            disabled={!item.enabled}
                            onClick={() => updateField(item._id, 'editType', 'YOU_GOT')}
                            className={`px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                              item.editType === 'YOU_GOT'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-white text-slate-400'
                            }`}
                          >
                            পেয়েছি
                          </button>
                        </div>
                        <div className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">৳</span>
                          <input
                            type="number"
                            min="0"
                            disabled={!item.enabled}
                            value={item.editAmount}
                            onChange={(e) => updateField(item._id, 'editAmount', e.target.value)}
                            className="w-full pl-7 pr-3 py-1.5 text-right text-[15px] font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/20 disabled:opacity-60"
                            placeholder="০"
                          />
                        </div>
                      </div>

                      {/* note */}
                      <input
                        type="text"
                        disabled={!item.enabled}
                        value={item.editNote}
                        onChange={(e) => updateField(item._id, 'editNote', e.target.value)}
                        placeholder="বিবরণ (ঐচ্ছিক)"
                        className="w-full text-[12px] text-slate-600 border-b border-slate-100 py-1 bg-transparent focus:outline-none placeholder:text-slate-300 disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {items.some((i) => !i.resolvedPartyId) && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>কিছু নাম মেলেনি। উপরের ড্রপডাউন থেকে পার্টি বেছে দিন অথবা সেই এন্ট্রিগুলো বাতিল করুন।</span>
              </div>
            )}
          </div>
        )}

        {/* ── saving ── */}
        {step === 'saving' && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Loader2 className="w-10 h-10 text-[#1B3A6B] animate-spin" />
            <p className="font-semibold text-slate-700">সংরক্ষণ করা হচ্ছে…</p>
          </div>
        )}
      </div>

      {/* ── sticky confirm button ── */}
      {step === 'review' && (
        <div className="shrink-0 px-4 pb-[calc(1rem+var(--safe-bottom))] pt-3 bg-white border-t border-slate-100 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={enabledCount === 0}
            className="w-full bg-[#1B3A6B] text-white rounded-2xl py-4 font-bold text-[15px] disabled:opacity-40 hover:bg-[#1B3A6B]/90 active:scale-[0.98] transition-all"
          >
            সব হিসাব নিশ্চিত ও সেভ করুন ({enabledCount}টি)
          </button>
        </div>
      )}
    </div>
  );
}
