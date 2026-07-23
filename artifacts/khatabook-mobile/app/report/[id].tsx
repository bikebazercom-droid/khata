/**
 * Customer Statement / Report Screen
 *
 * Route:  /report/<partyId>
 * Params: id (partyId)
 *
 * Shows a date-filtered statement with PDF download and share actions.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
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

// ─── Bengali digit helpers ────────────────────────────────────────────────────

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

// ─── Date filter logic ────────────────────────────────────────────────────────

type FilterKey = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

interface FilterOption { key: FilterKey; label: string; }
const FILTERS: FilterOption[] = [
  { key: 'today',     label: 'আজ' },
  { key: 'yesterday', label: 'গতকাল' },
  { key: 'week',      label: 'গত সপ্তাহ' },
  { key: 'month',     label: 'গত মাস' },
  { key: 'custom',    label: 'কাস্টম' },
];

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
): { start: Date; end: Date } {
  const now = new Date();
  const today = dayStart(now);
  switch (key) {
    case 'today':
      return { start: dayStart(today), end: dayEnd(today) };
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { start: dayStart(y), end: dayEnd(y) };
    }
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

function filterLabel(key: FilterKey, customStart: Date, customEnd: Date): string {
  if (key === 'custom') {
    return `${fmtDate(customStart)} — ${fmtDate(customEnd)}`;
  }
  return FILTERS.find(f => f.key === key)?.label ?? '';
}

// ─── Inline Date Picker ───────────────────────────────────────────────────────

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

interface InlineDatePickerProps {
  label: string;
  date: Date;
  onChange: (d: Date) => void;
}

function InlineDatePicker({ label, date, onChange }: InlineDatePickerProps) {
  const d = date.getDate();
  const m = date.getMonth();
  const y = date.getFullYear();
  const maxDay = daysInMonth(y, m);

  function adjust(field: 'day' | 'month' | 'year', delta: number) {
    const next = new Date(date);
    if (field === 'day') {
      let nd = d + delta;
      if (nd < 1) nd = maxDay;
      if (nd > maxDay) nd = 1;
      next.setDate(nd);
    } else if (field === 'month') {
      let nm = m + delta;
      if (nm < 0) nm = 11;
      if (nm > 11) nm = 0;
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
    <View style={dpStyles.cell}>
      <TouchableOpacity onPress={() => adjust(field, 1)} hitSlop={{ top: 8, bottom: 4, left: 12, right: 12 }}>
        <Feather name="chevron-up" size={16} color="#475569" />
      </TouchableOpacity>
      <Text style={dpStyles.val}>{value}</Text>
      <TouchableOpacity onPress={() => adjust(field, -1)} hitSlop={{ top: 4, bottom: 8, left: 12, right: 12 }}>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={dpStyles.wrap}>
      <Text style={dpStyles.label}>{label}</Text>
      <View style={dpStyles.row}>
        {cell(toBn(d), 'day')}
        <Text style={dpStyles.sep}>/</Text>
        {cell(MONTHS_BN[m], 'month')}
        <Text style={dpStyles.sep}>/</Text>
        {cell(toBn(y), 'year')}
      </View>
    </View>
  );
}

const dpStyles = StyleSheet.create({
  wrap: { flex: 1 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 8, paddingVertical: 4 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  val: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginVertical: 2, textAlign: 'center' },
  sep: { fontSize: 14, color: '#CBD5E1', marginHorizontal: 4 },
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
  body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #1e293b; font-size: 13px; }
  h1 { font-size: 22px; color: #004B93; margin: 0 0 2px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .summary { display: flex; gap: 12px; margin-bottom: 20px; }
  .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
  .card .lbl { font-size: 11px; color: #64748b; margin-bottom: 4px; }
  .card .val { font-size: 16px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #004B93; color: #fff; padding: 8px 10px; font-size: 12px; text-align: left; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .footer { margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
<h1>📒 বাংলা খাতা — স্টেটমেন্ট</h1>
<div class="sub">
  গ্রাহক: <strong>${opts.partyName}</strong>
  ${opts.partyPhone ? ` · ফোন: ${opts.partyPhone}` : ''}
  <br/>সময়কাল: ${opts.filterLbl}
  <br/>তৈরির তারিখ: ${fmtDate(new Date())}
</div>

<div class="summary">
  <div class="card">
    <div class="lbl">মোট দিয়েছেন</div>
    <div class="val" style="color:#16a34a">${fmtCur(opts.totalGave)}</div>
  </div>
  <div class="card">
    <div class="lbl">মোট পেয়েছেন</div>
    <div class="val" style="color:#dc2626">${fmtCur(opts.totalReceived)}</div>
  </div>
  <div class="card">
    <div class="lbl">নেট ব্যালেন্স</div>
    <div class="val" style="color:${netColor}">${fmtCur(Math.abs(opts.net))}<br/><small style="font-size:10px">${netSign}</small></div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>তারিখ</th>
      <th>বিবরণ</th>
      <th style="text-align:right">দিয়েছেন (৳)</th>
      <th style="text-align:right">পেয়েছেন (৳)</th>
    </tr>
  </thead>
  <tbody>
    ${rows.length ? rows : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">এই সময়কালে কোনো লেনদেন নেই</td></tr>'}
  </tbody>
</table>

<div class="footer">বাংলা খাতা — সম্পূর্ণ নিরাপদ ও সুরক্ষিত ✔️</div>
</body>
</html>`;
}

// ─── Report Screen ────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors();

  const [filter, setFilter]           = useState<FilterKey>('month');
  const [customStart, setCustomStart] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [customEnd,   setCustomEnd]   = useState(() => new Date());
  const [generating,  setGenerating]  = useState<'pdf' | 'whatsapp' | null>(null);

  const { data: party,   isLoading: pLoading } = useGetParty(id!);
  const { data: entries = [], isLoading: eLoading } = useListLedgerEntries(id!);

  const { start, end } = useMemo(
    () => getRange(filter, customStart, customEnd),
    [filter, customStart, customEnd],
  );

  const filtered = useMemo(
    () => entries.filter(e => {
      const t = new Date(e.createdAt).getTime();
      return t >= start.getTime() && t <= end.getTime();
    }),
    [entries, start, end],
  );

  const totalGave     = useMemo(() => filtered.filter(e => e.type === 'YOU_GAVE').reduce((s, e) => s + e.amount, 0), [filtered]);
  const totalReceived = useMemo(() => filtered.filter(e => e.type === 'YOU_GOT').reduce((s, e)  => s + e.amount, 0), [filtered]);
  const net           = useMemo(() => totalGave - totalReceived, [totalGave, totalReceived]);
  const isGet         = party ? party.balanceType === 'YOU_WILL_GET' : net > 0;

  const handleShare = useCallback(async (mode: 'pdf' | 'whatsapp') => {
    if (!party) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGenerating(mode);
    try {
      const html = buildPdfHtml({
        partyName:     party.name,
        partyPhone:    party.phone,
        filterLbl:     filterLabel(filter, customStart, customEnd),
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
        dialogTitle: mode === 'whatsapp'
          ? 'WhatsApp-এ শেয়ার করুন'
          : 'PDF ডাউনলোড করুন',
        UTI: 'com.adobe.pdf',
      });
    } catch (err) {
      Alert.alert('ত্রুটি', 'PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setGenerating(null);
    }
  }, [party, filter, customStart, customEnd, filtered, totalGave, totalReceived, net, isGet]);

  const isLoading = pLoading || eLoading;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    container:    { flex: 1, backgroundColor: colors.background },
    header:       { paddingTop: Platform.OS === 'web' ? 16 : insets.top + 8, paddingBottom: 16, paddingHorizontal: 16, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', gap: 14 },
    headerTitle:  { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
    headerSub:    { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular' },
    body:         { flex: 1 },

    // Filter chips
    filterWrap:   { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
    chipRow:      { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    chipActive:   { borderColor: colors.primary, backgroundColor: colors.primary },
    chipText:     { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    chipTextActive: { color: '#fff' },

    // Custom date row
    dateRow:      { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },

    // Summary stats
    statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, paddingBottom: 12 },
    statCard:     { width: '47%', backgroundColor: colors.card, borderRadius: colors.radius, padding: 14, borderWidth: 1, borderColor: colors.border },
    statLabel:    { fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginBottom: 4 },
    statValue:    { fontSize: 18, fontFamily: 'Inter_700Bold' },
    statSub:      { fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },

    // Entries
    sectionHead:  { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
    sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    entryRow:     { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    dot:          { width: 8, height: 8, borderRadius: 4, marginTop: 5, marginRight: 10 },
    entryDesc:    { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 },
    entryMeta:    { fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginTop: 2 },
    entryAmt:     { fontSize: 15, fontFamily: 'Inter_700Bold', textAlign: 'right' },

    emptyBox:     { alignItems: 'center', paddingVertical: 36 },
    emptyText:    { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 10 },

    // Bottom bar
    bottomBar:    { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? insets.bottom + 8 : 16, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    pdfBtn:       { flex: 1, paddingVertical: 15, borderRadius: colors.radius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: colors.primary },
    waBtn:        { flex: 1, paddingVertical: 15, borderRadius: colors.radius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, backgroundColor: '#25D366' },
    btnText:      { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  });

  return (
    <View style={s.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        {/* ── Filter chips ─────────────────────────────────────────────────── */}
        <View style={s.filterWrap}>
          <View style={s.chipRow}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[s.chip, filter === f.key && s.chipActive]}
                onPress={() => { Haptics.selectionAsync(); setFilter(f.key); }}
                activeOpacity={0.75}
              >
                <Text style={[s.chipText, filter === f.key && s.chipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Custom date pickers ───────────────────────────────────────────── */}
        {filter === 'custom' && (
          <View style={s.dateRow}>
            <InlineDatePicker label="শুরুর তারিখ" date={customStart} onChange={setCustomStart} />
            <InlineDatePicker label="শেষের তারিখ" date={customEnd}   onChange={setCustomEnd} />
          </View>
        )}

        {/* ── Loading ───────────────────────────────────────────────────────── */}
        {isLoading ? (
          <View style={{ padding: 48, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {/* ── Summary stat cards ──────────────────────────────────────── */}
            <View style={s.statsGrid}>
              {/* Gave */}
              <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.willGet }]}>
                <Text style={s.statLabel}>মোট দিয়েছেন</Text>
                <Text style={[s.statValue, { color: colors.willGet }]}>{fmtCur(totalGave)}</Text>
              </View>
              {/* Received */}
              <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.willGive }]}>
                <Text style={s.statLabel}>মোট পেয়েছেন</Text>
                <Text style={[s.statValue, { color: colors.willGive }]}>{fmtCur(totalReceived)}</Text>
              </View>
              {/* Net */}
              <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: isGet ? colors.willGet : colors.willGive }]}>
                <Text style={s.statLabel}>নেট ব্যালেন্স</Text>
                <Text style={[s.statValue, { color: isGet ? colors.willGet : colors.willGive }]}>
                  {fmtCur(Math.abs(net))}
                </Text>
                <Text style={s.statSub}>{isGet ? '↑ পাবেন' : '↓ দেবেন'}</Text>
              </View>
              {/* Count */}
              <View style={[s.statCard, { borderLeftWidth: 3, borderLeftColor: colors.primary }]}>
                <Text style={s.statLabel}>মোট এন্ট্রি</Text>
                <Text style={[s.statValue, { color: colors.primary }]}>{toBn(filtered.length)}</Text>
                <Text style={s.statSub}>টি লেনদেন</Text>
              </View>
            </View>

            {/* ── Entry list ──────────────────────────────────────────────── */}
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>
                লেনদেনের বিবরণ · {filterLabel(filter, customStart, customEnd)}
              </Text>
            </View>

            {filtered.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="inbox" size={36} color={colors.border} />
                <Text style={s.emptyText}>এই সময়কালে কোনো লেনদেন নেই</Text>
              </View>
            ) : (
              filtered.map(entry => {
                const isGave = entry.type === 'YOU_GAVE';
                return (
                  <View key={entry.id} style={s.entryRow}>
                    <View style={[s.dot, { backgroundColor: isGave ? colors.willGet : colors.willGive, marginTop: 5 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.entryDesc} numberOfLines={2}>
                        {entry.description || (isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}
                      </Text>
                      <Text style={s.entryMeta}>
                        {fmtDateStr(entry.createdAt)} · {fmtTimeStr(entry.createdAt)}
                      </Text>
                      <Text style={[{ fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 2, color: isGave ? colors.willGet : colors.willGive }]}>
                        {isGave ? '▲ দিয়েছেন' : '▼ পেয়েছেন'}
                      </Text>
                    </View>
                    <Text style={[s.entryAmt, { color: isGave ? colors.willGet : colors.willGive }]}>
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

      {/* ── Bottom action bar ──────────────────────────────────────────────── */}
      <View style={s.bottomBar}>
        <TouchableOpacity
          style={[s.pdfBtn, generating === 'pdf' && { opacity: 0.65 }]}
          onPress={() => handleShare('pdf')}
          disabled={generating !== null}
          activeOpacity={0.85}
        >
          {generating === 'pdf' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="download" size={17} color="#fff" />
          )}
          <Text style={s.btnText}>
            {generating === 'pdf' ? 'তৈরি হচ্ছে…' : 'ডাউনলোড PDF'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.waBtn, generating === 'whatsapp' && { opacity: 0.65 }]}
          onPress={() => handleShare('whatsapp')}
          disabled={generating !== null}
          activeOpacity={0.85}
        >
          {generating === 'whatsapp' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="share-2" size={17} color="#fff" />
          )}
          <Text style={s.btnText}>
            {generating === 'whatsapp' ? 'তৈরি হচ্ছে…' : 'WhatsApp শেয়ার'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
