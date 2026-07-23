/**
 * Customer Statement / Report Screen
 *
 * Route:  /report/<partyId>
 * Params: id (partyId)
 *
 * Filter is chosen via a bottom-sheet modal ("রিপোর্ট সময়কাল নির্বাচন করুন").
 * Stats and entry list update live based on the chosen period.
 * Bottom bar: "ডাউনলোড PDF" + "WhatsApp-এ শেয়ার করুন" using expo-print + expo-sharing.
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Animated,
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
  '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
  '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
};
const toBn = (s: string | number) =>
  String(s).split('').map(c => BN[c] ?? c).join('');

const fmtCur = (n: number) => {
  const abs = Math.abs(n);
  const grouped = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return `৳${grouped.split('').map(c => BN[c] ?? c).join('')}`;
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const fmtDateStr = (d: string) => fmtDate(new Date(d));

const fmtTimeStr = (d: string) =>
  new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

// ─── Filter definitions ───────────────────────────────────────────────────────

type FilterKey = 'all' | 'one_day' | 'week' | 'month' | 'custom';

interface FilterOption {
  key: FilterKey;
  label: string;        // shown in the list and on the selector button
  sublabel: string;     // secondary description inside the sheet
}

const FILTERS: FilterOption[] = [
  { key: 'all',     label: 'সব',               sublabel: 'সমস্ত লেনদেন দেখান' },
  { key: 'one_day', label: 'এক দিন',           sublabel: 'শুধু আজকের লেনদেন' },
  { key: 'week',    label: 'গত সপ্তাহে',        sublabel: 'গত ৭ দিনের লেনদেন' },
  { key: 'month',   label: 'গত মাসের',          sublabel: 'গত ৩০ দিনের লেনদেন' },
  { key: 'custom',  label: 'তারিখের পরিসর',     sublabel: 'নিজে তারিখ নির্বাচন করুন' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function dayEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function getRange(
  key: FilterKey,
  customStart: Date,
  customEnd: Date,
): { start: Date; end: Date } | null {
  const now = new Date();
  const today = dayStart(now);
  switch (key) {
    case 'all':
      return null; // null means "no filtering"
    case 'one_day':
      return { start: dayStart(today), end: dayEnd(today) };
    case 'week': {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      return { start: dayStart(w), end: dayEnd(now) };
    }
    case 'month': {
      const m = new Date(today); m.setDate(m.getDate() - 29);
      return { start: dayStart(m), end: dayEnd(now) };
    }
    case 'custom':
      return { start: dayStart(customStart), end: dayEnd(customEnd) };
  }
}

function humanFilterLabel(key: FilterKey, customStart: Date, customEnd: Date): string {
  if (key === 'custom') {
    return `${fmtDate(customStart)} — ${fmtDate(customEnd)}`;
  }
  return FILTERS.find(f => f.key === key)?.label ?? '';
}

// ─── Inline Date Picker (used inside the bottom sheet) ───────────────────────

const MONTHS_BN = [
  'জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন',
  'জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর',
];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function InlineDatePicker({
  label, date, onChange,
}: {
  label: string; date: Date; onChange: (d: Date) => void;
}) {
  const d = date.getDate(), m = date.getMonth(), y = date.getFullYear();

  function adjust(field: 'day' | 'month' | 'year', delta: number) {
    const next = new Date(date);
    if (field === 'day') {
      const max = daysInMonth(y, m);
      let nd = d + delta;
      if (nd < 1) nd = max; if (nd > max) nd = 1;
      next.setDate(nd);
    } else if (field === 'month') {
      let nm = m + delta;
      if (nm < 0) nm = 11; if (nm > 11) nm = 0;
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

  const cell = (value: string, field: 'day' | 'month' | 'year') => (
    <View style={dp.cell}>
      <TouchableOpacity onPress={() => adjust(field, 1)} hitSlop={{ top: 6, bottom: 2, left: 10, right: 10 }}>
        <Feather name="chevron-up" size={15} color="#475569" />
      </TouchableOpacity>
      <Text style={dp.val}>{value}</Text>
      <TouchableOpacity onPress={() => adjust(field, -1)} hitSlop={{ top: 2, bottom: 6, left: 10, right: 10 }}>
        <Feather name="chevron-down" size={15} color="#475569" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={dp.wrap}>
      <Text style={dp.label}>{label}</Text>
      <View style={dp.row}>
        {cell(toBn(d), 'day')}
        <Text style={dp.sep}>/</Text>
        {cell(MONTHS_BN[m], 'month')}
        <Text style={dp.sep}>/</Text>
        {cell(toBn(y), 'year')}
      </View>
    </View>
  );
}

const dp = StyleSheet.create({
  wrap:  { flex: 1 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#64748B', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 },
  row:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 6, paddingVertical: 3 },
  cell:  { flex: 1, alignItems: 'center', paddingVertical: 3 },
  val:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginVertical: 1, textAlign: 'center' },
  sep:   { fontSize: 13, color: '#CBD5E1', marginHorizontal: 3 },
});

// ─── PDF HTML Generator ───────────────────────────────────────────────────────

function buildPdfHtml(opts: {
  partyName: string;
  partyPhone?: string | null;
  filterLbl: string;
  entries: LedgerEntry[];
  totalGave: number;
  totalReceived: number;
  net: number;
  isGet: boolean;
}): string {
  const rows = opts.entries.map(e => {
    const isGave = e.type === 'YOU_GAVE';
    return `
      <tr>
        <td>${fmtDateStr(e.createdAt)}<br/><small style="color:#64748b">${fmtTimeStr(e.createdAt)}</small></td>
        <td>${e.description || (isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}</td>
        <td style="color:#16a34a;text-align:right">${isGave ? fmtCur(e.amount) : '—'}</td>
        <td style="color:#dc2626;text-align:right">${!isGave ? fmtCur(e.amount) : '—'}</td>
      </tr>`;
  }).join('');

  const netColor = opts.isGet ? '#16a34a' : '#dc2626';
  const netSign  = opts.isGet ? '↑ আপনি পাবেন' : '↓ আপনি দেবেন';

  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;font-size:13px}
  h1{font-size:22px;color:#004B93;margin:0 0 2px}
  .sub{color:#64748b;font-size:12px;margin-bottom:20px}
  .summary{display:flex;gap:12px;margin-bottom:20px}
  .card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
  .card .lbl{font-size:11px;color:#64748b;margin-bottom:4px}
  .card .val{font-size:16px;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th{background:#004B93;color:#fff;padding:8px 10px;font-size:12px;text-align:left}
  td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  tr:last-child td{border-bottom:none}
  .footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<h1>📒 বাংলা খাতা — স্টেটমেন্ট</h1>
<div class="sub">
  গ্রাহক: <strong>${opts.partyName}</strong>${opts.partyPhone ? ` · ফোন: ${opts.partyPhone}` : ''}
  <br/>সময়কাল: ${opts.filterLbl}
  <br/>তৈরির তারিখ: ${fmtDate(new Date())}
</div>
<div class="summary">
  <div class="card"><div class="lbl">মোট দিয়েছেন</div><div class="val" style="color:#16a34a">${fmtCur(opts.totalGave)}</div></div>
  <div class="card"><div class="lbl">মোট পেয়েছেন</div><div class="val" style="color:#dc2626">${fmtCur(opts.totalReceived)}</div></div>
  <div class="card"><div class="lbl">নেট ব্যালেন্স</div><div class="val" style="color:${netColor}">${fmtCur(Math.abs(opts.net))}<br/><small style="font-size:10px">${netSign}</small></div></div>
</div>
<table>
  <thead>
    <tr><th>তারিখ</th><th>বিবরণ</th><th style="text-align:right">দিয়েছেন (৳)</th><th style="text-align:right">পেয়েছেন (৳)</th></tr>
  </thead>
  <tbody>
    ${rows.length ? rows : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">এই সময়কালে কোনো লেনদেন নেই</td></tr>'}
  </tbody>
</table>
<div class="footer">বাংলা খাতা — সম্পূর্ণ নিরাপদ ও সুরক্ষিত ✔️</div>
</body>
</html>`;
}

// ─── Period Filter Bottom Sheet ───────────────────────────────────────────────

interface FilterSheetProps {
  visible: boolean;
  currentFilter: FilterKey;
  pendingFilter: FilterKey;
  setPendingFilter: (k: FilterKey) => void;
  customStart: Date;
  customEnd: Date;
  setCustomStart: (d: Date) => void;
  setCustomEnd: (d: Date) => void;
  onApply: () => void;
  onClose: () => void;
  slideAnim: Animated.Value;
  colors: ReturnType<typeof useColors>;
  insets: { bottom: number };
}

function FilterSheet({
  visible, pendingFilter, setPendingFilter,
  customStart, customEnd, setCustomStart, setCustomEnd,
  onApply, onClose, slideAnim, colors, insets,
}: FilterSheetProps) {
  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Dimmed backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(0,0,0,0.45)' },
            { opacity: slideAnim },
          ]}
        />
      </TouchableWithoutFeedback>

      {/* Sheet panel */}
      <Animated.View
        style={[
          sh.panel,
          { paddingBottom: Math.max(insets.bottom, 16) },
          { transform: [{ translateY }] },
        ]}
      >
        {/* Drag handle */}
        <View style={sh.handle} />

        {/* Title row */}
        <View style={sh.titleRow}>
          <Text style={sh.title}>রিপোর্ট সময়কাল নির্বাচন করুন</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>

        <View style={sh.divider} />

        {/* Radio list */}
        {FILTERS.map((f, i) => {
          const selected = pendingFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                sh.option,
                i < FILTERS.length - 1 && sh.optionBorder,
                selected && { backgroundColor: '#EFF6FF' },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setPendingFilter(f.key);
              }}
              activeOpacity={0.7}
            >
              {/* Radio circle */}
              <View style={[sh.radio, selected && { borderColor: colors.primary }]}>
                {selected && <View style={[sh.radioDot, { backgroundColor: colors.primary }]} />}
              </View>

              {/* Labels */}
              <View style={{ flex: 1 }}>
                <Text style={[sh.optionLabel, selected && { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                  {f.label}
                </Text>
                <Text style={sh.optionSub}>{f.sublabel}</Text>
              </View>

              {selected && (
                <Feather name="check" size={16} color={colors.primary} />
              )}
            </TouchableOpacity>
          );
        })}

        {/* Custom date pickers — shown inline when তারিখের পরিসর is pending */}
        {pendingFilter === 'custom' && (
          <View style={sh.datePickers}>
            <InlineDatePicker label="শুরুর তারিখ" date={customStart} onChange={setCustomStart} />
            <View style={{ width: 12 }} />
            <InlineDatePicker label="শেষের তারিখ" date={customEnd}   onChange={setCustomEnd} />
          </View>
        )}

        <View style={sh.divider} />

        {/* Apply button */}
        <TouchableOpacity
          style={[sh.applyBtn, { backgroundColor: colors.primary }]}
          onPress={onApply}
          activeOpacity={0.85}
        >
          <Text style={sh.applyText}>প্রয়োগ করুন</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const sh = StyleSheet.create({
  panel:      { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 20 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 16 },
  titleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14 },
  title:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#1E293B', flex: 1 },
  divider:    { height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 0 },
  option:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, gap: 14 },
  optionBorder: { borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  radio:      { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  radioDot:   { width: 10, height: 10, borderRadius: 5 },
  optionLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginBottom: 1 },
  optionSub:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#94A3B8' },
  datePickers: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  applyBtn:   { marginHorizontal: 20, marginTop: 14, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  applyText:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// ─── Report Screen ────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors();

  // Applied filter state
  const [filter,       setFilter]       = useState<FilterKey>('all');
  const [customStart,  setCustomStart]  = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [customEnd,    setCustomEnd]    = useState(() => new Date());

  // Sheet state (pending = what's selected inside the sheet before Apply)
  const [sheetOpen,    setSheetOpen]    = useState(false);
  const [pendingFilter, setPendingFilter] = useState<FilterKey>('all');
  const [pendingStart,  setPendingStart]  = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [pendingEnd,    setPendingEnd]    = useState(() => new Date());

  // Sheet slide animation
  const slideAnim = useRef(new Animated.Value(0)).current;

  function openSheet() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPendingFilter(filter);
    setPendingStart(customStart);
    setPendingEnd(customEnd);
    setSheetOpen(true);
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();
  }

  function closeSheet() {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setSheetOpen(false));
  }

  function applySheet() {
    setFilter(pendingFilter);
    setCustomStart(pendingStart);
    setCustomEnd(pendingEnd);
    closeSheet();
  }

  // Data
  const { data: party,        isLoading: pLoading } = useGetParty(id!);
  const { data: entries = [], isLoading: eLoading } = useListLedgerEntries(id!);

  const range = useMemo(
    () => getRange(filter, customStart, customEnd),
    [filter, customStart, customEnd],
  );

  const filtered = useMemo(() => {
    if (!range) return entries; // 'all'
    return entries.filter(e => {
      const t = new Date(e.createdAt).getTime();
      return t >= range.start.getTime() && t <= range.end.getTime();
    });
  }, [entries, range]);

  const totalGave     = useMemo(() => filtered.filter(e => e.type === 'YOU_GAVE').reduce((s, e) => s + e.amount, 0), [filtered]);
  const totalReceived = useMemo(() => filtered.filter(e => e.type === 'YOU_GOT').reduce((s, e)  => s + e.amount, 0), [filtered]);
  const net           = useMemo(() => totalGave - totalReceived, [totalGave, totalReceived]);
  const isGet         = party ? party.balanceType === 'YOU_WILL_GET' : net > 0;

  const [generating, setGenerating] = useState<'pdf' | 'whatsapp' | null>(null);

  const handleShare = useCallback(async (mode: 'pdf' | 'whatsapp') => {
    if (!party) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGenerating(mode);
    try {
      const html = buildPdfHtml({
        partyName:     party.name,
        partyPhone:    party.phone,
        filterLbl:     humanFilterLabel(filter, customStart, customEnd),
        entries:       filtered,
        totalGave,
        totalReceived,
        net,
        isGet,
      });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
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

  // ── Styles ───────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    container:   { flex: 1, backgroundColor: colors.background },

    // Header
    header:      { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8, paddingBottom: 16, paddingHorizontal: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 14 },
    headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff', flex: 1 },
    headerSub:   { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_400Regular' },

    // Period selector bar (tappable — opens sheet)
    selectorBar:    { flexDirection: 'row', alignItems: 'center', margin: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
    selectorIcon:   { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary + '18', alignItems: 'center', justifyContent: 'center' },
    selectorLabel:  { flex: 1 },
    selectorTitle:  { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginBottom: 1 },
    selectorValue:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.foreground },

    // Stats grid
    statsWrap:   { paddingHorizontal: 14, paddingBottom: 6 },
    statsRow:    { flexDirection: 'row', gap: 10, marginBottom: 10 },
    statCard:    { flex: 1, backgroundColor: colors.card, borderRadius: colors.radius, padding: 14, borderWidth: 1, borderColor: colors.border },
    statLabel:   { fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginBottom: 5 },
    statValue:   { fontSize: 19, fontFamily: 'Inter_700Bold' },
    statSub:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },

    // Section header
    sectionHead: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },

    // Entry rows
    entryRow:    { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    dot:         { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
    entryMain:   { flex: 1 },
    entryDesc:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.foreground },
    entryMeta:   { fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    entryTag:    { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
    entryAmt:    { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'right' },

    // Empty
    emptyBox:    { alignItems: 'center', paddingVertical: 40 },
    emptyText:   { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 10 },

    // Bottom bar
    bottomBar:   { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? insets.bottom + 8 : 16, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    pdfBtn:      { flex: 1, paddingVertical: 15, borderRadius: colors.radius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: colors.primary },
    waBtn:       { flex: 1, paddingVertical: 15, borderRadius: colors.radius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: '#25D366' },
    btnText:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  });

  const currentFilterOption = FILTERS.find(f => f.key === filter)!;

  return (
    <View style={s.container}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {pLoading ? 'লোড হচ্ছে…' : (party?.name ?? 'স্টেটমেন্ট')}
          </Text>
          <Text style={s.headerSub}>গ্রাহক স্টেটমেন্ট</Text>
        </View>
        <Feather name="file-text" size={20} color="rgba(255,255,255,0.8)" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

        {/* ── Period selector bar ──────────────────────────────────────────── */}
        <TouchableOpacity style={s.selectorBar} onPress={openSheet} activeOpacity={0.75}>
          <View style={s.selectorIcon}>
            <Feather name="calendar" size={16} color={colors.primary} />
          </View>
          <View style={s.selectorLabel}>
            <Text style={s.selectorTitle}>সময়কাল</Text>
            <Text style={s.selectorValue} numberOfLines={1}>
              {filter === 'custom'
                ? humanFilterLabel('custom', customStart, customEnd)
                : currentFilterOption.label}
            </Text>
          </View>
          <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {isLoading ? (
          <View style={{ padding: 56, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {/* ── Stats grid ────────────────────────────────────────────────── */}
            <View style={s.statsWrap}>
              <View style={s.statsRow}>
                {/* মোট ব্যালেন্স */}
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: isGet ? colors.willGet : colors.willGive }]}>
                  <Text style={s.statLabel}>মোট ব্যালেন্স</Text>
                  <Text style={[s.statValue, { color: isGet ? colors.willGet : colors.willGive }]}>
                    {fmtCur(Math.abs(net))}
                  </Text>
                  <Text style={s.statSub}>{isGet ? '↑ পাবেন' : '↓ দেবেন'}</Text>
                </View>
                {/* মোট এন্ট্রি সংখ্যা */}
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.primary }]}>
                  <Text style={s.statLabel}>মোট এন্ট্রি সংখ্যা</Text>
                  <Text style={[s.statValue, { color: colors.primary }]}>{toBn(filtered.length)}</Text>
                  <Text style={s.statSub}>টি লেনদেন</Text>
                </View>
              </View>
              <View style={s.statsRow}>
                {/* আপনি দিয়েছেন */}
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.willGet }]}>
                  <Text style={s.statLabel}>আপনি দিয়েছেন</Text>
                  <Text style={[s.statValue, { color: colors.willGet }]}>{fmtCur(totalGave)}</Text>
                </View>
                {/* আপনি পেয়েছেন */}
                <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.willGive }]}>
                  <Text style={s.statLabel}>আপনি পেয়েছেন</Text>
                  <Text style={[s.statValue, { color: colors.willGive }]}>{fmtCur(totalReceived)}</Text>
                </View>
              </View>
            </View>

            {/* ── Entry section header ──────────────────────────────────────── */}
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>
                লেনদেনের বিবরণ
                {filter !== 'all' && ` · ${humanFilterLabel(filter, customStart, customEnd)}`}
              </Text>
            </View>

            {/* ── Entry list ────────────────────────────────────────────────── */}
            {filtered.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="inbox" size={40} color={colors.border} />
                <Text style={s.emptyText}>এই সময়কালে কোনো লেনদেন নেই</Text>
              </View>
            ) : (
              filtered.map(entry => {
                const isGave = entry.type === 'YOU_GAVE';
                const accentColor = isGave ? colors.willGet : colors.willGive;
                return (
                  <View key={entry.id} style={s.entryRow}>
                    <View style={[s.dot, { backgroundColor: accentColor }]} />
                    <View style={s.entryMain}>
                      <Text style={s.entryDesc} numberOfLines={2}>
                        {entry.description || (isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}
                      </Text>
                      <Text style={s.entryMeta}>
                        {fmtDateStr(entry.createdAt)} · {fmtTimeStr(entry.createdAt)}
                      </Text>
                      <Text style={[s.entryTag, { color: accentColor }]}>
                        {isGave ? '▲ দিয়েছেন' : '▼ পেয়েছেন'}
                      </Text>
                    </View>
                    <Text style={[s.entryAmt, { color: accentColor }]}>
                      {isGave ? '+' : '-'}{fmtCur(entry.amount)}
                    </Text>
                  </View>
                );
              })
            )}

            <View style={{ height: 24 }} />
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
          {generating === 'pdf'
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="download" size={17} color="#fff" />}
          <Text style={s.btnText}>
            {generating === 'pdf' ? 'তৈরি হচ্ছে…' : 'ডাউনলোড PDF'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.waBtn, generating === 'whatsapp' && { opacity: 0.6 }]}
          onPress={() => handleShare('whatsapp')}
          disabled={generating !== null}
          activeOpacity={0.85}
        >
          {generating === 'whatsapp'
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="share-2" size={17} color="#fff" />}
          <Text style={s.btnText}>
            {generating === 'whatsapp' ? 'তৈরি হচ্ছে…' : 'WhatsApp-এ শেয়ার করুন'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Bottom sheet filter modal ─────────────────────────────────────────── */}
      <FilterSheet
        visible={sheetOpen}
        currentFilter={filter}
        pendingFilter={pendingFilter}
        setPendingFilter={setPendingFilter}
        customStart={pendingStart}
        customEnd={pendingEnd}
        setCustomStart={setPendingStart}
        setCustomEnd={setPendingEnd}
        onApply={applySheet}
        onClose={closeSheet}
        slideAnim={slideAnim}
        colors={colors}
        insets={{ bottom: insets.bottom }}
      />
    </View>
  );
}
