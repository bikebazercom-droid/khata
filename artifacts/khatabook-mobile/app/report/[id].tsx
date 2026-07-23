/**
 * Customer Statement / Report Screen  —  app/report/[id].tsx
 *
 * Layout
 * ──────
 *  Blue header: ← <Name> এর রিপোর্ট
 *  Filter bar:  [আরম্ভের তারিখ] [শেষের তারিখ] [⚙ filter button]
 *  Search bar:  🔍 এন্ট্রি অনুসন্ধান করুন
 *  Stats grid:  মোট ব্যালেন্স · মোট এন্ট্রি · দিয়েছেন · পেয়েছেন
 *  Entry list
 *  Bottom bar:  [ডাউনলোড PDF]  [WhatsApp-এ শেয়ার করুন]
 *
 * The filter bottom sheet ("রিপোর্ট সময়কাল নির্বাচন করুন") is opened by the
 * filter button and provides radio shortcuts that auto-fill the date boxes.
 * Tapping either date box opens a small popup date-picker (switches to custom mode).
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Animated,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { useGetParty, useListLedgerEntries } from '@workspace/api-client-react';
import type { LedgerEntry } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

// ─── Bengali helpers ──────────────────────────────────────────────────────────

const BN: Record<string, string> = {
  '0': '০','1': '১','2': '২','3': '৩','4': '৪',
  '5': '৫','6': '৬','7': '৭','8': '৮','9': '৯',
};
const toBn = (s: string | number) =>
  String(s).split('').map(c => BN[c] ?? c).join('');

const fmtCur = (n: number) => {
  const abs = Math.abs(n);
  const str = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return `৳${str.split('').map(c => BN[c] ?? c).join('')}`;
};

// Short date like "১ জুল ২০২৬"
const SHORT_MONTHS = ['জান','ফেব','মার','এপ্র','মে','জুন','জুল','আগ','সেপ','অক্ট','নভ','ডিস'];
const fmtShort = (d: Date) =>
  `${toBn(d.getDate())} ${SHORT_MONTHS[d.getMonth()]} ${toBn(d.getFullYear())}`;

// Long date like "1 Jul 2026" for PDF
const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const fmtDateStr = (d: string) => fmtDate(new Date(d));
const fmtTimeStr = (d: string) =>
  new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

// ─── Filter definitions ───────────────────────────────────────────────────────

type FilterKey = 'all' | 'one_day' | 'week' | 'month' | 'custom';

interface FilterOption { key: FilterKey; label: string; sublabel: string; }
const FILTERS: FilterOption[] = [
  { key: 'all',     label: 'সব',             sublabel: 'সমস্ত লেনদেন দেখান' },
  { key: 'one_day', label: 'এক দিন',         sublabel: 'শুধু আজকের লেনদেন' },
  { key: 'week',    label: 'গত সপ্তাহে',      sublabel: 'গত ৭ দিনের লেনদেন' },
  { key: 'month',   label: 'গত মাসের',        sublabel: 'গত ৩০ দিনের লেনদেন' },
  { key: 'custom',  label: 'তারিখের পরিসর',   sublabel: 'নিজে তারিখ নির্বাচন করুন' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function dayEnd(d: Date)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

/** Returns the {start, end} dates for a given filter key. null = show all. */
function getRange(key: FilterKey, cStart: Date, cEnd: Date): { start: Date; end: Date } | null {
  const now = new Date();
  const today = dayStart(now);
  switch (key) {
    case 'all':     return null;
    case 'one_day': return { start: dayStart(today), end: dayEnd(today) };
    case 'week': {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      return { start: dayStart(w), end: dayEnd(now) };
    }
    case 'month': {
      const m = new Date(today); m.setDate(m.getDate() - 29);
      return { start: dayStart(m), end: dayEnd(now) };
    }
    case 'custom':  return { start: dayStart(cStart), end: dayEnd(cEnd) };
  }
}

/** Returns the computed start/end for the date boxes (never null). */
function getDisplayDates(key: FilterKey, cStart: Date, cEnd: Date): { start: Date; end: Date } {
  const range = getRange(key, cStart, cEnd);
  if (!range) {
    const today = new Date();
    return { start: new Date(today.getFullYear(), 0, 1), end: today }; // Jan 1 → today
  }
  return range;
}

/** Human-readable label for the PDF. */
function humanFilterLabel(key: FilterKey, cStart: Date, cEnd: Date): string {
  if (key === 'all') return 'সব সময়';
  if (key === 'custom') return `${fmtDate(cStart)} — ${fmtDate(cEnd)}`;
  return FILTERS.find(f => f.key === key)?.label ?? '';
}

// ─── Spinner Wheel Date Picker ────────────────────────────────────────────────

const MONTHS_BN = [
  'জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন',
  'জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর',
];
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

function SpinnerDatePicker({ date, onChange }: { date: Date; onChange: (d: Date) => void }) {
  const d = date.getDate(), m = date.getMonth(), y = date.getFullYear();

  function adjust(field: 'day' | 'month' | 'year', delta: number) {
    const next = new Date(date);
    if (field === 'day') {
      const max = daysInMonth(y, m);
      let nd = d + delta;
      if (nd < 1) nd = max; if (nd > max) nd = 1;
      next.setDate(nd);
    } else if (field === 'month') {
      let nm = m + delta; if (nm < 0) nm = 11; if (nm > 11) nm = 0;
      next.setMonth(nm);
      const cap = daysInMonth(next.getFullYear(), nm);
      if (next.getDate() > cap) next.setDate(cap);
    } else {
      next.setFullYear(y + delta);
      const cap = daysInMonth(next.getFullYear(), m);
      if (next.getDate() > cap) next.setDate(cap);
    }
    onChange(next);
  }

  const cell = (value: string, field: 'day' | 'month' | 'year', wide?: boolean) => (
    <View style={[spn.cell, wide && { flex: 2 }]}>
      <TouchableOpacity onPress={() => adjust(field, 1)} hitSlop={{ top: 8, bottom: 4, left: 16, right: 16 }}>
        <Feather name="chevron-up" size={18} color="#475569" />
      </TouchableOpacity>
      <Text style={spn.val} numberOfLines={1}>{value}</Text>
      <TouchableOpacity onPress={() => adjust(field, -1)} hitSlop={{ top: 4, bottom: 8, left: 16, right: 16 }}>
        <Feather name="chevron-down" size={18} color="#475569" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={spn.row}>
      {cell(toBn(d), 'day')}
      <Text style={spn.sep}>/</Text>
      {cell(MONTHS_BN[m], 'month', true)}
      <Text style={spn.sep}>/</Text>
      {cell(toBn(y), 'year')}
    </View>
  );
}
const spn = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  cell: { flex: 1, alignItems: 'center' },
  val:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#1E293B', marginVertical: 4, textAlign: 'center' },
  sep:  { fontSize: 16, color: '#CBD5E1', marginHorizontal: 8 },
});

// ─── Date Picker Popup ────────────────────────────────────────────────────────

function DatePickerPopup({
  visible, label, date, onConfirm, onClose,
}: {
  visible: boolean; label: string; date: Date;
  onConfirm: (d: Date) => void; onClose: () => void;
}) {
  const [local, setLocal] = useState(date);

  // reset local when opened
  React.useEffect(() => { if (visible) setLocal(date); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={pop.backdrop} />
      </TouchableWithoutFeedback>
      <View style={pop.box}>
        <Text style={pop.title}>{label}</Text>
        <SpinnerDatePicker date={local} onChange={setLocal} />
        <View style={pop.btnRow}>
          <TouchableOpacity style={pop.cancel} onPress={onClose} activeOpacity={0.8}>
            <Text style={pop.cancelTxt}>বাতিল</Text>
          </TouchableOpacity>
          <TouchableOpacity style={pop.confirm} onPress={() => { onConfirm(local); onClose(); }} activeOpacity={0.85}>
            <Text style={pop.confirmTxt}>নিশ্চিত</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
const pop = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  box:      { position: 'absolute', left: 20, right: 20, top: '30%', backgroundColor: '#fff', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 24, elevation: 24 },
  title:    { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#1E293B', marginBottom: 12, textAlign: 'center' },
  btnRow:   { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancel:   { flex: 1, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  cancelTxt:{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#64748B' },
  confirm:  { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#004B93', alignItems: 'center' },
  confirmTxt:{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// ─── PDF HTML ─────────────────────────────────────────────────────────────────

function buildPdfHtml(opts: {
  partyName: string; partyPhone?: string | null;
  filterLbl: string; entries: LedgerEntry[];
  totalGave: number; totalReceived: number; net: number; isGet: boolean;
}): string {
  const rows = opts.entries.map(e => {
    const isGave = e.type === 'YOU_GAVE';
    return `<tr>
      <td>${fmtDateStr(e.createdAt)}<br/><small style="color:#64748b">${fmtTimeStr(e.createdAt)}</small></td>
      <td>${e.description || (isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}</td>
      <td style="color:#16a34a;text-align:right">${isGave ? fmtCur(e.amount) : '—'}</td>
      <td style="color:#dc2626;text-align:right">${!isGave ? fmtCur(e.amount) : '—'}</td>
    </tr>`;
  }).join('');
  const nc = opts.isGet ? '#16a34a' : '#dc2626';
  const ns = opts.isGet ? '↑ আপনি পাবেন' : '↓ আপনি দেবেন';
  return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"/>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;font-size:13px}
  h1{font-size:22px;color:#004B93;margin:0 0 2px}
  .sub{color:#64748b;font-size:12px;margin-bottom:20px}
  .summary{display:flex;gap:12px;margin-bottom:20px}
  .card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
  .lbl{font-size:11px;color:#64748b;margin-bottom:4px} .val{font-size:16px;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th{background:#004B93;color:#fff;padding:8px 10px;font-size:12px;text-align:left}
  td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  tr:last-child td{border-bottom:none}
  .footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8}
</style></head><body>
<h1>📒 বাংলা খাতা — স্টেটমেন্ট</h1>
<div class="sub">গ্রাহক: <strong>${opts.partyName}</strong>${opts.partyPhone ? ` · ফোন: ${opts.partyPhone}` : ''}
<br/>সময়কাল: ${opts.filterLbl}<br/>তৈরির তারিখ: ${fmtDate(new Date())}</div>
<div class="summary">
  <div class="card"><div class="lbl">মোট দিয়েছেন</div><div class="val" style="color:#16a34a">${fmtCur(opts.totalGave)}</div></div>
  <div class="card"><div class="lbl">মোট পেয়েছেন</div><div class="val" style="color:#dc2626">${fmtCur(opts.totalReceived)}</div></div>
  <div class="card"><div class="lbl">নেট ব্যালেন্স</div><div class="val" style="color:${nc}">${fmtCur(Math.abs(opts.net))}<br/><small style="font-size:10px">${ns}</small></div></div>
</div>
<table><thead><tr><th>তারিখ</th><th>বিবরণ</th><th style="text-align:right">দিয়েছেন (৳)</th><th style="text-align:right">পেয়েছেন (৳)</th></tr></thead>
<tbody>${rows.length ? rows : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">কোনো লেনদেন নেই</td></tr>'}</tbody></table>
<div class="footer">বাংলা খাতা — সম্পূর্ণ নিরাপদ ও সুরক্ষিত ✔️</div>
</body></html>`;
}

// ─── Filter Bottom Sheet ──────────────────────────────────────────────────────

function FilterSheet({
  visible, pendingFilter, setPendingFilter,
  pendingStart, pendingEnd, setPendingStart, setPendingEnd,
  onApply, onClose, slideAnim, primaryColor, bottomInset,
}: {
  visible: boolean;
  pendingFilter: FilterKey; setPendingFilter: (k: FilterKey) => void;
  pendingStart: Date; pendingEnd: Date;
  setPendingStart: (d: Date) => void; setPendingEnd: (d: Date) => void;
  onApply: () => void; onClose: () => void;
  slideAnim: Animated.Value; primaryColor: string; bottomInset: number;
}) {
  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [700, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.45)' }, { opacity: slideAnim }]} />
      </TouchableWithoutFeedback>

      <Animated.View style={[bsh.panel, { paddingBottom: Math.max(bottomInset, 16) }, { transform: [{ translateY }] }]}>
        <View style={bsh.handle} />

        <View style={bsh.titleRow}>
          <Text style={bsh.title}>রিপোর্ট সময়কাল নির্বাচন করুন</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>

        <View style={bsh.divider} />

        {FILTERS.map((f, i) => {
          const sel = pendingFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[bsh.option, i < FILTERS.length - 1 && bsh.optBorder, sel && { backgroundColor: '#EFF6FF' }]}
              onPress={() => { Haptics.selectionAsync(); setPendingFilter(f.key); }}
              activeOpacity={0.7}
            >
              <View style={[bsh.radio, sel && { borderColor: primaryColor }]}>
                {sel && <View style={[bsh.radioDot, { backgroundColor: primaryColor }]} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[bsh.optLabel, sel && { color: primaryColor, fontFamily: 'Inter_700Bold' }]}>{f.label}</Text>
                <Text style={bsh.optSub}>{f.sublabel}</Text>
              </View>
              {sel && <Feather name="check" size={16} color={primaryColor} />}
            </TouchableOpacity>
          );
        })}

        {/* Inline date pickers only when custom is selected */}
        {pendingFilter === 'custom' && (
          <View style={bsh.datePickers}>
            <View style={{ flex: 1 }}>
              <Text style={bsh.datePickerLabel}>আরম্ভের তারিখ</Text>
              <SpinnerDatePicker date={pendingStart} onChange={setPendingStart} />
            </View>
            <View style={{ width: 1, backgroundColor: '#E2E8F0', marginHorizontal: 12, alignSelf: 'stretch' }} />
            <View style={{ flex: 1 }}>
              <Text style={bsh.datePickerLabel}>শেষের তারিখ</Text>
              <SpinnerDatePicker date={pendingEnd} onChange={setPendingEnd} />
            </View>
          </View>
        )}

        <View style={bsh.divider} />

        <TouchableOpacity style={[bsh.applyBtn, { backgroundColor: primaryColor }]} onPress={onApply} activeOpacity={0.85}>
          <Text style={bsh.applyTxt}>প্রয়োগ করুন</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const bsh = StyleSheet.create({
  panel:         { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 24 },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 16 },
  titleRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14 },
  title:         { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#1E293B', flex: 1 },
  divider:       { height: 1, backgroundColor: '#F1F5F9' },
  option:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  optBorder:     { borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  radio:         { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  radioDot:      { width: 10, height: 10, borderRadius: 5 },
  optLabel:      { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginBottom: 1 },
  optSub:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#94A3B8' },
  datePickers:   { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12 },
  datePickerLabel:{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  applyBtn:      { marginHorizontal: 20, marginTop: 14, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  applyTxt:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// ─── Report Screen ────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors();

  // ── Applied filter ─────────────────────────────────────────────────────────
  const [filter,      setFilter]      = useState<FilterKey>('all');
  const [customStart, setCustomStart] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [customEnd,   setCustomEnd]   = useState(() => new Date());

  // ── Sheet (pending state — committed only on "প্রয়োগ করুন") ──────────────
  const [sheetOpen,      setSheetOpen]      = useState(false);
  const [pendingFilter,  setPendingFilter]  = useState<FilterKey>('all');
  const [pendingStart,   setPendingStart]   = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [pendingEnd,     setPendingEnd]     = useState(() => new Date());
  const slideAnim = useRef(new Animated.Value(0)).current;

  // ── Date-box popup ─────────────────────────────────────────────────────────
  const [datePop, setDatePop] = useState<null | 'start' | 'end'>(null);

  // ── Search query ───────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: party,        isLoading: pLoading } = useGetParty(id!);
  const { data: entries = [], isLoading: eLoading } = useListLedgerEntries(id!);

  // ── Derived dates (for date boxes) ────────────────────────────────────────
  const displayDates = useMemo(
    () => getDisplayDates(filter, customStart, customEnd),
    [filter, customStart, customEnd],
  );

  // ── Filtered entries ───────────────────────────────────────────────────────
  const dateFiltered = useMemo(() => {
    const range = getRange(filter, customStart, customEnd);
    if (!range) return entries;
    return entries.filter(e => {
      const t = new Date(e.createdAt).getTime();
      return t >= range.start.getTime() && t <= range.end.getTime();
    });
  }, [entries, filter, customStart, customEnd]);

  const filtered = useMemo(() => {
    if (!query.trim()) return dateFiltered;
    const q = query.trim().toLowerCase();
    return dateFiltered.filter(e =>
      (e.description ?? '').toLowerCase().includes(q),
    );
  }, [dateFiltered, query]);

  // ── Computed totals ────────────────────────────────────────────────────────
  const totalGave     = useMemo(() => filtered.filter(e => e.type === 'YOU_GAVE').reduce((s, e) => s + e.amount, 0), [filtered]);
  const totalReceived = useMemo(() => filtered.filter(e => e.type === 'YOU_GOT').reduce((s, e)  => s + e.amount, 0), [filtered]);
  const net           = useMemo(() => totalGave - totalReceived, [totalGave, totalReceived]);
  const isGet         = party ? party.balanceType === 'YOU_WILL_GET' : net > 0;

  // ── Sheet helpers ──────────────────────────────────────────────────────────
  function openSheet() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPendingFilter(filter);
    setPendingStart(customStart);
    setPendingEnd(customEnd);
    setSheetOpen(true);
    Animated.spring(slideAnim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
  }
  function closeSheet() {
    Animated.timing(slideAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setSheetOpen(false));
  }
  function applySheet() {
    setFilter(pendingFilter);
    if (pendingFilter === 'custom') {
      setCustomStart(pendingStart);
      setCustomEnd(pendingEnd);
    }
    closeSheet();
  }

  // ── Date box taps ──────────────────────────────────────────────────────────
  function handleDateBoxTap(which: 'start' | 'end') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDatePop(which);
  }
  function handleDatePopConfirm(d: Date) {
    if (datePop === 'start') {
      setCustomStart(d);
      if (d > customEnd) setCustomEnd(d);
    } else {
      setCustomEnd(d);
      if (d < customStart) setCustomStart(d);
    }
    setFilter('custom');
    setDatePop(null);
  }

  // ── PDF + share ────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState<'pdf' | 'whatsapp' | null>(null);

  const handleShare = useCallback(async (mode: 'pdf' | 'whatsapp') => {
    if (!party) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGenerating(mode);
    try {
      const html = buildPdfHtml({
        partyName: party.name, partyPhone: party.phone,
        filterLbl: humanFilterLabel(filter, customStart, customEnd),
        entries: filtered, totalGave, totalReceived, net, isGet,
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('শেয়ার করা যাচ্ছে না', 'এই ডিভাইসে শেয়ারিং সমর্থিত নয়।');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: mode === 'whatsapp' ? 'WhatsApp-এ শেয়ার করুন' : 'PDF ডাউনলোড করুন',
        UTI: 'com.adobe.pdf',
      });
    } catch {
      Alert.alert('ত্রুটি', 'PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setGenerating(null);
    }
  }, [party, filter, customStart, customEnd, filtered, totalGave, totalReceived, net, isGet]);

  const isLoading = pLoading || eLoading;
  const accentColor = (isGave: boolean) => isGave ? colors.willGet : colors.willGive;

  // ── Styles ─────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    container:   { flex: 1, backgroundColor: '#F1F5F9' },
    // Header
    header:      { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8, paddingBottom: 16, paddingHorizontal: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerName:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', flex: 1 },
    // Filter card
    filterCard:  { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 12, marginBottom: 0, borderRadius: 12, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 3 },
    dateRow:     { flexDirection: 'row', gap: 8, marginBottom: 10 },
    dateBox:     { flex: 1, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#F8FAFC' },
    dateBoxActive:{ borderColor: colors.primary },
    dateLabel:   { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#94A3B8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
    dateValue:   { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#1E293B' },
    filterBtnRow:{ flexDirection: 'row', gap: 8 },
    searchBox:   { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#F8FAFC', gap: 8 },
    searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#1E293B', paddingVertical: 10 },
    filterBtn:   { width: 44, height: 44, borderRadius: 8, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', alignItems: 'center', justifyContent: 'center' },
    filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '15' },
    // Stats
    statsWrap:   { paddingHorizontal: 12, paddingTop: 10 },
    statsRow:    { flexDirection: 'row', gap: 8, marginBottom: 8 },
    statCard:    { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 13, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
    statLabel:   { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#64748B', marginBottom: 5 },
    statValue:   { fontSize: 18, fontFamily: 'Inter_700Bold' },
    statSub:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 2 },
    // Section header
    sectionHead: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#F1F5F9' },
    sectionTxt:  { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
    // Entries
    entriesCard: { backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
    entryRow:    { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    dot:         { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
    entryMain:   { flex: 1 },
    entryDesc:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#1E293B' },
    entryMeta:   { fontSize: 11, color: '#94A3B8', fontFamily: 'Inter_400Regular', marginTop: 2 },
    entryTag:    { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 1 },
    entryAmt:    { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'right' },
    emptyBox:    { alignItems: 'center', paddingVertical: 40 },
    emptyTxt:    { color: '#94A3B8', fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 10 },
    // Bottom bar
    bottomBar:   { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? insets.bottom + 8 : 14, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
    pdfBtn:      { flex: 1, paddingVertical: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: colors.primary },
    waBtn:       { flex: 1, paddingVertical: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: '#25D366' },
    btnTxt:      { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },
  });

  const isFiltered = filter !== 'all';

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerName} numberOfLines={1}>
          {pLoading ? 'লোড হচ্ছে…' : `${party?.name ?? ''} এর রিপোর্ট`}
        </Text>
        <Feather name="file-text" size={19} color="rgba(255,255,255,0.8)" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Filter card ─────────────────────────────────────────────────── */}
        <View style={s.filterCard}>
          {/* Date range boxes */}
          <View style={s.dateRow}>
            {/* Start date */}
            <TouchableOpacity
              style={[s.dateBox, datePop === 'start' && s.dateBoxActive]}
              onPress={() => handleDateBoxTap('start')}
              activeOpacity={0.75}
            >
              <Text style={s.dateLabel}>আরম্ভের তারিখ</Text>
              <Text style={s.dateValue}>{fmtShort(displayDates.start)}</Text>
            </TouchableOpacity>

            {/* Divider arrow */}
            <View style={{ justifyContent: 'flex-end', paddingBottom: 10 }}>
              <Feather name="arrow-right" size={14} color="#94A3B8" />
            </View>

            {/* End date */}
            <TouchableOpacity
              style={[s.dateBox, datePop === 'end' && s.dateBoxActive]}
              onPress={() => handleDateBoxTap('end')}
              activeOpacity={0.75}
            >
              <Text style={s.dateLabel}>শেষের তারিখ</Text>
              <Text style={s.dateValue}>{fmtShort(displayDates.end)}</Text>
            </TouchableOpacity>
          </View>

          {/* Search bar + filter button */}
          <View style={s.filterBtnRow}>
            <View style={s.searchBox}>
              <Feather name="search" size={15} color="#94A3B8" />
              <TextInput
                style={s.searchInput}
                placeholder="এন্ট্রি অনুসন্ধান করুন"
                placeholderTextColor="#94A3B8"
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            <TouchableOpacity
              style={[s.filterBtn, isFiltered && s.filterBtnActive]}
              onPress={openSheet}
              activeOpacity={0.75}
            >
              <Feather name="sliders" size={18} color={isFiltered ? colors.primary : '#64748B'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Active filter pill ──────────────────────────────────────────── */}
        {isFiltered && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: 12, marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.primary + '18', gap: 6 }}
            onPress={openSheet}
            activeOpacity={0.7}
          >
            <Feather name="calendar" size={12} color={colors.primary} />
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary }}>
              {FILTERS.find(f => f.key === filter)?.label ?? 'কাস্টম'}
            </Text>
            <TouchableOpacity
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => { setFilter('all'); setQuery(''); }}
            >
              <Feather name="x" size={12} color={colors.primary} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {isLoading ? (
          <View style={{ padding: 56, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {/* ── Stats ──────────────────────────────────────────────────── */}
            <View style={s.statsWrap}>
              <View style={s.statsRow}>
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: isGet ? colors.willGet : colors.willGive }]}>
                  <Text style={s.statLabel}>মোট ব্যালেন্স</Text>
                  <Text style={[s.statValue, { color: isGet ? colors.willGet : colors.willGive }]}>{fmtCur(Math.abs(net))}</Text>
                  <Text style={s.statSub}>{isGet ? '↑ পাবেন' : '↓ দেবেন'}</Text>
                </View>
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.primary }]}>
                  <Text style={s.statLabel}>মোট এন্ট্রি সংখ্যা</Text>
                  <Text style={[s.statValue, { color: colors.primary }]}>{toBn(filtered.length)}</Text>
                  <Text style={s.statSub}>টি লেনদেন</Text>
                </View>
              </View>
              <View style={s.statsRow}>
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.willGet }]}>
                  <Text style={s.statLabel}>আপনি দিয়েছেন</Text>
                  <Text style={[s.statValue, { color: colors.willGet }]}>{fmtCur(totalGave)}</Text>
                </View>
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.willGive }]}>
                  <Text style={s.statLabel}>আপনি পেয়েছেন</Text>
                  <Text style={[s.statValue, { color: colors.willGive }]}>{fmtCur(totalReceived)}</Text>
                </View>
              </View>
            </View>

            {/* ── Section header ────────────────────────────────────────── */}
            <View style={s.sectionHead}>
              <Text style={s.sectionTxt}>
                {`লেনদেনের তালিকা`}
                {query.trim() ? ` · "${query}"` : ''}
                {` · ${toBn(filtered.length)} টি`}
              </Text>
            </View>

            {/* ── Entry list ────────────────────────────────────────────── */}
            <View style={s.entriesCard}>
              {filtered.length === 0 ? (
                <View style={s.emptyBox}>
                  <Feather name="inbox" size={40} color="#CBD5E1" />
                  <Text style={s.emptyTxt}>
                    {query.trim() ? 'কোনো মিল পাওয়া যায়নি' : 'এই সময়কালে কোনো লেনদেন নেই'}
                  </Text>
                </View>
              ) : (
                filtered.map((entry, idx) => {
                  const isGave = entry.type === 'YOU_GAVE';
                  const color  = accentColor(isGave);
                  return (
                    <View key={entry.id} style={[s.entryRow, idx === filtered.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={[s.dot, { backgroundColor: color }]} />
                      <View style={s.entryMain}>
                        <Text style={s.entryDesc} numberOfLines={2}>
                          {entry.description || (isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}
                        </Text>
                        <Text style={s.entryMeta}>{fmtDateStr(entry.createdAt)} · {fmtTimeStr(entry.createdAt)}</Text>
                        <Text style={[s.entryTag, { color }]}>{isGave ? '▲ দিয়েছেন' : '▼ পেয়েছেন'}</Text>
                      </View>
                      <Text style={[s.entryAmt, { color }]}>
                        {isGave ? '+' : '-'}{fmtCur(entry.amount)}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>

            <View style={{ height: 20 }} />
          </>
        )}
      </ScrollView>

      {/* ── Bottom action bar ────────────────────────────────────────────────── */}
      <View style={s.bottomBar}>
        <TouchableOpacity
          style={[s.pdfBtn, generating === 'pdf' && { opacity: 0.6 }]}
          onPress={() => handleShare('pdf')}
          disabled={generating !== null}
          activeOpacity={0.85}
        >
          {generating === 'pdf' ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="download" size={16} color="#fff" />}
          <Text style={s.btnTxt}>{generating === 'pdf' ? 'তৈরি হচ্ছে…' : 'ডাউনলোড PDF'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.waBtn, generating === 'whatsapp' && { opacity: 0.6 }]}
          onPress={() => handleShare('whatsapp')}
          disabled={generating !== null}
          activeOpacity={0.85}
        >
          {generating === 'whatsapp' ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="share-2" size={16} color="#fff" />}
          <Text style={s.btnTxt}>{generating === 'whatsapp' ? 'তৈরি হচ্ছে…' : 'WhatsApp-এ শেয়ার করুন'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Date picker popup ─────────────────────────────────────────────────── */}
      <DatePickerPopup
        visible={datePop !== null}
        label={datePop === 'start' ? 'আরম্ভের তারিখ নির্বাচন করুন' : 'শেষের তারিখ নির্বাচন করুন'}
        date={datePop === 'start' ? displayDates.start : displayDates.end}
        onConfirm={handleDatePopConfirm}
        onClose={() => setDatePop(null)}
      />

      {/* ── Filter bottom sheet ───────────────────────────────────────────────── */}
      <FilterSheet
        visible={sheetOpen}
        pendingFilter={pendingFilter}  setPendingFilter={setPendingFilter}
        pendingStart={pendingStart}    pendingEnd={pendingEnd}
        setPendingStart={setPendingStart} setPendingEnd={setPendingEnd}
        onApply={applySheet}  onClose={closeSheet}
        slideAnim={slideAnim} primaryColor={colors.primary}
        bottomInset={insets.bottom}
      />
    </KeyboardAvoidingView>
  );
}
