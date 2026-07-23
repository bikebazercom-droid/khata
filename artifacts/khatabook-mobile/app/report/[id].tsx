/**
 * Customer Statement / Report Screen  —  app/report/[id].tsx
 *
 * ┌──────────────────────────────────────┐  ← Dark-blue header zone
 * │ ← [Name] এর রিপোর্ট                 │
 * │ [আরম্ভের তারিখ]   [শেষের তারিখ]     │
 * │ 🔍 এন্ট্রি অনুসন্ধান করুন  | সব ▼  │
 * └──────────────────────────────────────┘
 *   Stats 2×2 (মোট ব্যালেন্স · এন্ট্রি · দিয়েছেন · পেয়েছেন)
 *   Entry list
 * ┌──────────────────────────────────────┐  ← Sticky bottom bar
 * │ [📄 PDF ডাউনলোড]  [⬡ শেয়ার করুন]  │
 * └──────────────────────────────────────┘
 *
 * Filter dropdown ("সব ▼") opens bottom sheet "রিপোর্ট সময়কাল নির্বাচন করুন".
 * Date boxes are tappable; popup spinner sets custom range.
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
  '0':'০','1':'১','2':'২','3':'৩','4':'৪',
  '5':'৫','6':'৬','7':'৭','8':'৮','9':'৯',
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

const SHORT_MO = ['জান','ফেব','মার','এপ্র','মে','জুন','জুল','আগ','সেপ','অক্ট','নভ','ডিস'];
const fmtShort = (d: Date) =>
  `${toBn(d.getDate())} ${SHORT_MO[d.getMonth()]} ${toBn(d.getFullYear())}`;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
const fmtDateStr = (d: string) => fmtDate(new Date(d));
const fmtTimeStr = (d: string) =>
  new Date(d).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

// ─── Filter definitions ───────────────────────────────────────────────────────

type FilterKey = 'all' | 'one_day' | 'week' | 'month' | 'custom';

interface FilterOption { key: FilterKey; label: string; sublabel: string; }
const FILTERS: FilterOption[] = [
  { key:'all',     label:'সব',           sublabel:'সমস্ত লেনদেন দেখান' },
  { key:'one_day', label:'এক দিন',       sublabel:'শুধু আজকের লেনদেন' },
  { key:'week',    label:'গত সপ্তাহে',   sublabel:'গত ৭ দিনের লেনদেন' },
  { key:'month',   label:'গত মাসের',     sublabel:'গত ৩০ দিনের লেনদেন' },
  { key:'custom',  label:'তারিখের পরিসর',sublabel:'নিজে তারিখ নির্বাচন করুন' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

const ds = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
const de = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

function getRange(key: FilterKey, cs: Date, ce: Date): { start: Date; end: Date } | null {
  const now = new Date(), today = ds(now);
  switch (key) {
    case 'all':     return null;
    case 'one_day': return { start: ds(today), end: de(today) };
    case 'week': {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      return { start: ds(w), end: de(now) };
    }
    case 'month': {
      const m = new Date(today); m.setDate(m.getDate() - 29);
      return { start: ds(m), end: de(now) };
    }
    case 'custom': return { start: ds(cs), end: de(ce) };
  }
}

function displayDates(key: FilterKey, cs: Date, ce: Date): { start: Date; end: Date } {
  const r = getRange(key, cs, ce);
  if (!r) {
    const t = new Date();
    return { start: new Date(t.getFullYear(), 0, 1), end: t };
  }
  return r;
}

function filterLabel(key: FilterKey, cs: Date, ce: Date): string {
  if (key === 'all') return 'সব সময়';
  if (key === 'custom') return `${fmtDate(cs)} — ${fmtDate(ce)}`;
  return FILTERS.find(f => f.key === key)?.label ?? '';
}

// ─── Spinner date picker ──────────────────────────────────────────────────────

const MONTHS_BN = [
  'জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন',
  'জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর',
];
const dim = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

function SpinnerPicker({ date, onChange }: { date: Date; onChange: (d: Date) => void }) {
  const d = date.getDate(), m = date.getMonth(), y = date.getFullYear();
  function adj(field: 'day'|'month'|'year', delta: number) {
    const n = new Date(date);
    if (field === 'day') {
      const max = dim(y, m); let nd = d + delta;
      if (nd < 1) nd = max; if (nd > max) nd = 1;
      n.setDate(nd);
    } else if (field === 'month') {
      let nm = m + delta; if (nm < 0) nm = 11; if (nm > 11) nm = 0;
      n.setMonth(nm);
      const cap = dim(n.getFullYear(), nm);
      if (n.getDate() > cap) n.setDate(cap);
    } else {
      n.setFullYear(y + delta);
      const cap = dim(n.getFullYear(), m);
      if (n.getDate() > cap) n.setDate(cap);
    }
    onChange(n);
  }
  const cell = (val: string, field: 'day'|'month'|'year', wide?: boolean) => (
    <View style={[sp.cell, wide && { flex: 2.2 }]}>
      <TouchableOpacity onPress={() => adj(field, 1)} hitSlop={{ top:8, bottom:4, left:14, right:14 }}>
        <Feather name="chevron-up" size={20} color="#334155" />
      </TouchableOpacity>
      <Text style={sp.val} numberOfLines={1}>{val}</Text>
      <TouchableOpacity onPress={() => adj(field, -1)} hitSlop={{ top:4, bottom:8, left:14, right:14 }}>
        <Feather name="chevron-down" size={20} color="#334155" />
      </TouchableOpacity>
    </View>
  );
  return (
    <View style={sp.row}>
      {cell(toBn(d), 'day')}
      <Text style={sp.sep}>/</Text>
      {cell(MONTHS_BN[m], 'month', true)}
      <Text style={sp.sep}>/</Text>
      {cell(toBn(y), 'year')}
    </View>
  );
}
const sp = StyleSheet.create({
  row:  { flexDirection:'row', alignItems:'center', paddingVertical:10 },
  cell: { flex:1, alignItems:'center' },
  val:  { fontSize:15, fontFamily:'Inter_700Bold', color:'#1E293B', marginVertical:5, textAlign:'center' },
  sep:  { fontSize:18, color:'#CBD5E1', marginHorizontal:6 },
});

// ─── Date popup modal ─────────────────────────────────────────────────────────

function DatePopup({ visible, label, date, onConfirm, onClose }: {
  visible: boolean; label: string; date: Date;
  onConfirm: (d: Date) => void; onClose: () => void;
}) {
  const [local, setLocal] = useState(date);
  React.useEffect(() => { if (visible) setLocal(date); }, [visible, date]);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={dp.bg} />
      </TouchableWithoutFeedback>
      <View style={dp.box}>
        <Text style={dp.title}>{label}</Text>
        <SpinnerPicker date={local} onChange={setLocal} />
        <View style={dp.btns}>
          <TouchableOpacity style={dp.cancel} onPress={onClose}>
            <Text style={dp.cancelTxt}>বাতিল</Text>
          </TouchableOpacity>
          <TouchableOpacity style={dp.ok} onPress={() => { onConfirm(local); onClose(); }}>
            <Text style={dp.okTxt}>নিশ্চিত করুন</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
const dp = StyleSheet.create({
  bg:       { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.55)' },
  box:      { position:'absolute', left:18, right:18, top:'28%', backgroundColor:'#fff', borderRadius:18, padding:22, shadowColor:'#000', shadowOffset:{width:0,height:10}, shadowOpacity:0.2, shadowRadius:30, elevation:30 },
  title:    { fontSize:15, fontFamily:'Inter_700Bold', color:'#1E293B', marginBottom:14, textAlign:'center' },
  btns:     { flexDirection:'row', gap:10, marginTop:18 },
  cancel:   { flex:1, paddingVertical:13, borderRadius:10, borderWidth:1.5, borderColor:'rgba(255,255,255,0.3)', backgroundColor:'rgba(255,255,255,0.12)', alignItems:'center' },
  cancelTxt:{ fontSize:14, fontFamily:'Inter_600SemiBold', color:'#64748B' },
  ok:       { flex:1, paddingVertical:13, borderRadius:10, backgroundColor:'#004B93', alignItems:'center' },
  okTxt:    { fontSize:14, fontFamily:'Inter_700Bold', color:'#fff' },
});

// ─── PDF HTML ─────────────────────────────────────────────────────────────────

function buildHtml(opts: {
  partyName:string; partyPhone?:string|null; filterLbl:string;
  entries:LedgerEntry[]; gave:number; received:number; net:number; isGet:boolean;
}): string {
  const rows = opts.entries.map(e => {
    const g = e.type === 'YOU_GAVE';
    return `<tr>
      <td>${fmtDateStr(e.createdAt)}<br/><small style="color:#64748b">${fmtTimeStr(e.createdAt)}</small></td>
      <td>${e.description||(g?'আপনি দিয়েছেন':'আপনি পেয়েছেন')}</td>
      <td style="color:#16a34a;text-align:right">${g?fmtCur(e.amount):'—'}</td>
      <td style="color:#dc2626;text-align:right">${!g?fmtCur(e.amount):'—'}</td>
    </tr>`;
  }).join('');
  const nc = opts.isGet ? '#16a34a' : '#dc2626';
  const ns = opts.isGet ? '↑ আপনি পাবেন' : '↓ আপনি দেবেন';
  return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"/>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;font-size:13px}
  h1{font-size:20px;color:#004B93;margin:0 0 4px}
  .sub{color:#64748b;font-size:12px;margin-bottom:18px}
  .summ{display:flex;gap:10px;margin-bottom:18px}
  .card{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center}
  .lbl{font-size:11px;color:#64748b;margin-bottom:3px} .val{font-size:15px;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th{background:#004B93;color:#fff;padding:7px 9px;font-size:12px;text-align:left}
  td{padding:7px 9px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  tr:last-child td{border-bottom:none}
  .ft{margin-top:22px;text-align:center;font-size:11px;color:#94a3b8}
</style></head><body>
<h1>📒 বাংলা খাতা — স্টেটমেন্ট</h1>
<div class="sub">গ্রাহক: <strong>${opts.partyName}</strong>${opts.partyPhone?` · ${opts.partyPhone}`:''}
<br/>সময়কাল: ${opts.filterLbl} · তৈরি: ${fmtDate(new Date())}</div>
<div class="summ">
  <div class="card"><div class="lbl">দিয়েছেন</div><div class="val" style="color:#16a34a">${fmtCur(opts.gave)}</div></div>
  <div class="card"><div class="lbl">পেয়েছেন</div><div class="val" style="color:#dc2626">${fmtCur(opts.received)}</div></div>
  <div class="card"><div class="lbl">নেট</div><div class="val" style="color:${nc}">${fmtCur(Math.abs(opts.net))}<br/><small style="font-size:10px">${ns}</small></div></div>
</div>
<table><thead><tr><th>তারিখ</th><th>বিবরণ</th><th style="text-align:right">দিয়েছেন</th><th style="text-align:right">পেয়েছেন</th></tr></thead>
<tbody>${rows||'<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:18px">কোনো লেনদেন নেই</td></tr>'}</tbody></table>
<div class="ft">বাংলা খাতা — সম্পূর্ণ নিরাপদ ও সুরক্ষিত ✔️</div>
</body></html>`;
}

// ─── Filter Bottom Sheet ──────────────────────────────────────────────────────

function FilterSheet({
  visible, pendingFilter, setPendingFilter,
  pendingStart, pendingEnd, setPendingStart, setPendingEnd,
  onApply, onClose, anim, primary, bottomInset,
}: {
  visible:boolean; pendingFilter:FilterKey; setPendingFilter:(k:FilterKey)=>void;
  pendingStart:Date; pendingEnd:Date;
  setPendingStart:(d:Date)=>void; setPendingEnd:(d:Date)=>void;
  onApply:()=>void; onClose:()=>void;
  anim:Animated.Value; primary:string; bottomInset:number;
}) {
  const ty = anim.interpolate({ inputRange:[0,1], outputRange:[700,0] });
  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor:'rgba(0,0,0,0.45)', opacity:anim }]} />
      </TouchableWithoutFeedback>
      <Animated.View style={[bsh.panel, { paddingBottom:Math.max(bottomInset,16), transform:[{translateY:ty}] }]}>
        <View style={bsh.handle} />
        <View style={bsh.titleRow}>
          <Text style={bsh.title}>রিপোর্ট সময়কাল নির্বাচন করুন</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Feather name="x" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>
        <View style={bsh.div} />
        {FILTERS.map((f,i) => {
          const sel = pendingFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[bsh.opt, i < FILTERS.length-1 && bsh.optB, sel && { backgroundColor:'#EFF6FF' }]}
              onPress={() => { Haptics.selectionAsync(); setPendingFilter(f.key); }}
              activeOpacity={0.7}
            >
              <View style={[bsh.radio, sel && { borderColor:primary }]}>
                {sel && <View style={[bsh.dot, { backgroundColor:primary }]} />}
              </View>
              <View style={{ flex:1 }}>
                <Text style={[bsh.optL, sel && { color:primary, fontFamily:'Inter_700Bold' }]}>{f.label}</Text>
                <Text style={bsh.optS}>{f.sublabel}</Text>
              </View>
              {sel && <Feather name="check" size={16} color={primary} />}
            </TouchableOpacity>
          );
        })}
        {pendingFilter === 'custom' && (
          <View style={bsh.pickers}>
            <View style={{ flex:1 }}>
              <Text style={bsh.pickerLbl}>আরম্ভের তারিখ</Text>
              <SpinnerPicker date={pendingStart} onChange={setPendingStart} />
            </View>
            <View style={{ width:1, backgroundColor:'#E2E8F0', marginHorizontal:14, alignSelf:'stretch' }} />
            <View style={{ flex:1 }}>
              <Text style={bsh.pickerLbl}>শেষের তারিখ</Text>
              <SpinnerPicker date={pendingEnd} onChange={setPendingEnd} />
            </View>
          </View>
        )}
        <View style={bsh.div} />
        <TouchableOpacity style={[bsh.apply, { backgroundColor:primary }]} onPress={onApply} activeOpacity={0.85}>
          <Text style={bsh.applyTxt}>প্রয়োগ করুন</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}
const bsh = StyleSheet.create({
  panel:    { position:'absolute', bottom:0, left:0, right:0, backgroundColor:'#fff', borderTopLeftRadius:22, borderTopRightRadius:22, paddingTop:12, shadowColor:'#000', shadowOffset:{width:0,height:-6}, shadowOpacity:0.14, shadowRadius:24, elevation:24 },
  handle:   { width:40, height:4, borderRadius:2, backgroundColor:'#CBD5E1', alignSelf:'center', marginBottom:16 },
  titleRow: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingBottom:14 },
  title:    { fontSize:16, fontFamily:'Inter_700Bold', color:'#1E293B', flex:1 },
  div:      { height:1, backgroundColor:'#F1F5F9' },
  opt:      { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:14, gap:14 },
  optB:     { borderBottomWidth:1, borderBottomColor:'#F8FAFC' },
  radio:    { width:20, height:20, borderRadius:10, borderWidth:2, borderColor:'#CBD5E1', alignItems:'center', justifyContent:'center' },
  dot:      { width:10, height:10, borderRadius:5 },
  optL:     { fontSize:15, fontFamily:'Inter_600SemiBold', color:'#1E293B', marginBottom:1 },
  optS:     { fontSize:12, fontFamily:'Inter_400Regular', color:'#94A3B8' },
  pickers:  { flexDirection:'row', paddingHorizontal:20, paddingVertical:14 },
  pickerLbl:{ fontSize:11, fontFamily:'Inter_600SemiBold', color:'#64748B', textTransform:'uppercase', letterSpacing:0.4, marginBottom:4 },
  apply:    { marginHorizontal:20, marginTop:14, paddingVertical:16, borderRadius:12, alignItems:'center' },
  applyTxt: { fontSize:16, fontFamily:'Inter_700Bold', color:'#fff' },
});

// ─── Main Report Screen ───────────────────────────────────────────────────────

export default function ReportScreen() {
  const { id }  = useLocalSearchParams<{ id:string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const colors  = useColors();

  const PRIMARY = colors.primary;   // dark blue

  // Applied filter
  const [filter,  setFilter]  = useState<FilterKey>('all');
  const [cStart,  setCStart]  = useState(() => { const d=new Date(); d.setDate(1); return d; });
  const [cEnd,    setCEnd]    = useState(() => new Date());

  // Sheet pending state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pFilter,   setPFilter]   = useState<FilterKey>('all');
  const [pStart,    setPStart]    = useState(() => { const d=new Date(); d.setDate(1); return d; });
  const [pEnd,      setPEnd]      = useState(() => new Date());
  const anim = useRef(new Animated.Value(0)).current;

  // Date popup
  const [datePop, setDatePop] = useState<null|'start'|'end'>(null);

  // Search
  const [query, setQuery] = useState('');

  // Type filter: 'all' | 'gave' | 'got'
  const [typeFilter, setTypeFilter] = useState<'all' | 'gave' | 'got'>('all');

  // Data
  const { data:party, isLoading:pL } = useGetParty(id!);
  const { data:entries=[], isLoading:eL } = useListLedgerEntries(id!);

  // Computed display dates (for the header boxes)
  const disp = useMemo(() => displayDates(filter, cStart, cEnd), [filter, cStart, cEnd]);

  // Filtered by date
  const dateFiltered = useMemo(() => {
    const r = getRange(filter, cStart, cEnd);
    if (!r) return entries;
    return entries.filter(e => {
      const t = new Date(e.createdAt).getTime();
      return t >= r.start.getTime() && t <= r.end.getTime();
    });
  }, [entries, filter, cStart, cEnd]);

  // Running balance per entry (within the date-filtered window, sorted oldest→newest)
  const runningBalances = useMemo(() => {
    const sorted = [...dateFiltered].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    let bal = 0;
    const map = new Map<string, number>();
    for (const e of sorted) {
      bal += e.type === 'YOU_GAVE' ? e.amount : -e.amount;
      map.set(e.id, bal);
    }
    return map;
  }, [dateFiltered]);

  // Filtered by type, then search
  const filtered = useMemo(() => {
    let list = dateFiltered;
    if (typeFilter === 'gave') list = list.filter(e => e.type === 'YOU_GAVE');
    if (typeFilter === 'got')  list = list.filter(e => e.type === 'YOU_GOT');
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(e => (e.description??'').toLowerCase().includes(q));
  }, [dateFiltered, typeFilter, query]);

  // Totals (always over the full date-filtered set, not type-filtered)
  const gave     = useMemo(() => dateFiltered.filter(e=>e.type==='YOU_GAVE').reduce((s,e)=>s+e.amount,0), [dateFiltered]);
  const received = useMemo(() => dateFiltered.filter(e=>e.type==='YOU_GOT').reduce((s,e)=>s+e.amount,0), [dateFiltered]);
  const net      = useMemo(() => gave - received, [gave, received]);
  const isGet    = party ? party.balanceType === 'YOU_WILL_GET' : net > 0;

  // Sheet helpers
  function openSheet() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPFilter(filter); setPStart(cStart); setPEnd(cEnd);
    setSheetOpen(true);
    Animated.spring(anim, { toValue:1, useNativeDriver:true, damping:18, stiffness:180 }).start();
  }
  function closeSheet() {
    Animated.timing(anim, { toValue:0, duration:220, useNativeDriver:true }).start(() => setSheetOpen(false));
  }
  function applySheet() {
    setFilter(pFilter);
    if (pFilter === 'custom') { setCStart(pStart); setCEnd(pEnd); }
    closeSheet();
  }

  // Date box popup
  function onDateConfirm(d: Date) {
    if (datePop === 'start') {
      setCStart(d); if (d > cEnd) setCEnd(d);
    } else {
      setCEnd(d); if (d < cStart) setCStart(d);
    }
    setFilter('custom');
    setDatePop(null);
  }

  // PDF generate (save via native print dialog)
  const [pdfBusy,   setPdfBusy]   = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const getHtml = useCallback(() => buildHtml({
    partyName: party?.name ?? '',
    partyPhone: party?.phone,
    filterLbl: filterLabel(filter, cStart, cEnd),
    entries: filtered, gave, received, net, isGet,
  }), [party, filter, cStart, cEnd, filtered, gave, received, net, isGet]);

  async function handlePdf() {
    if (!party) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPdfBusy(true);
    try {
      await Print.printAsync({ html: getHtml() });
    } catch (e: any) {
      // User cancelled print → no error alert needed
      if (!String(e).includes('cancel')) {
        Alert.alert('ত্রুটি', 'PDF তৈরি করা যায়নি।');
      }
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleShare() {
    if (!party) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShareBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: getHtml(), base64:false });
      const ok = await Sharing.isAvailableAsync();
      if (!ok) { Alert.alert('শেয়ার করা যাচ্ছে না', 'এই ডিভাইসে শেয়ারিং সমর্থিত নয়।'); return; }
      await Sharing.shareAsync(uri, { mimeType:'application/pdf', UTI:'com.adobe.pdf', dialogTitle:'শেয়ার করুন' });
    } catch {
      Alert.alert('ত্রুটি', 'শেয়ার করা যায়নি।');
    } finally {
      setShareBusy(false);
    }
  }

  const loading = pL || eL;
  const curLbl  = FILTERS.find(f=>f.key===filter)?.label ?? 'সব';

  // ── Styles ──────────────────────────────────────────────────────────────────
  const HEADER_BG = PRIMARY;          // e.g. #004B93
  const HEADER_OVERLAY = 'rgba(0,0,0,0.18)'; // slight darken on date boxes

  return (
    <KeyboardAvoidingView style={{ flex:1, backgroundColor:'#F1F5F9' }} behavior={Platform.OS==='ios'?'padding':undefined}>

      {/* ══════════════════════════════════════════════════════════════════════
          DARK-BLUE HEADER ZONE
          ══════════════════════════════════════════════════════════════════════ */}
      <View style={{ backgroundColor:HEADER_BG, paddingTop: Platform.OS==='web' ? 16 : insets.top + 6, paddingBottom:16, paddingHorizontal:14 }}>

        {/* Title row */}
        <View style={{ flexDirection:'row', alignItems:'center', marginBottom:14, gap:10 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={{ flex:1, fontSize:17, fontFamily:'Inter_700Bold', color:'#fff' }} numberOfLines={1}>
            {pL ? 'লোড হচ্ছে…' : `${party?.name ?? ''} এর রিপোর্ট`}
          </Text>
          <Feather name="file-text" size={18} color="rgba(255,255,255,0.75)" />
        </View>

        {/* Date boxes row */}
        <View style={{ flexDirection:'row', gap:8, marginBottom:10 }}>
          {/* Start date */}
          <TouchableOpacity
            style={{ flex:1, backgroundColor:HEADER_OVERLAY, borderRadius:10, paddingHorizontal:12, paddingVertical:9, borderWidth:1, borderColor:'rgba(255,255,255,0.25)' }}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDatePop('start'); }}
            activeOpacity={0.75}
          >
            <Text style={{ fontSize:10, color:'rgba(255,255,255,0.7)', fontFamily:'Inter_500Medium', marginBottom:2 }}>
              আরম্ভের তারিখ
            </Text>
            <View style={{ flexDirection:'row', alignItems:'center', gap:5 }}>
              <Feather name="calendar" size={12} color="rgba(255,255,255,0.8)" />
              <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:'#fff' }}>{fmtShort(disp.start)}</Text>
            </View>
          </TouchableOpacity>

          {/* Arrow */}
          <View style={{ justifyContent:'flex-end', paddingBottom:10 }}>
            <Feather name="arrow-right" size={14} color="rgba(255,255,255,0.6)" />
          </View>

          {/* End date */}
          <TouchableOpacity
            style={{ flex:1, backgroundColor:HEADER_OVERLAY, borderRadius:10, paddingHorizontal:12, paddingVertical:9, borderWidth:1, borderColor:'rgba(255,255,255,0.25)' }}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDatePop('end'); }}
            activeOpacity={0.75}
          >
            <Text style={{ fontSize:10, color:'rgba(255,255,255,0.7)', fontFamily:'Inter_500Medium', marginBottom:2 }}>
              শেষের তারিখ
            </Text>
            <View style={{ flexDirection:'row', alignItems:'center', gap:5 }}>
              <Feather name="calendar" size={12} color="rgba(255,255,255,0.8)" />
              <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:'#fff' }}>{fmtShort(disp.end)}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Search bar + filter dropdown */}
        <View style={{ flexDirection:'row', backgroundColor:'rgba(255,255,255,0.15)', borderRadius:10, borderWidth:1, borderColor:'rgba(255,255,255,0.22)', alignItems:'center', paddingLeft:10 }}>
          <Feather name="search" size={15} color="rgba(255,255,255,0.7)" />
          <TextInput
            style={{ flex:1, fontSize:14, fontFamily:'Inter_400Regular', color:'#fff', paddingVertical:11, paddingHorizontal:8 }}
            placeholder="এন্ট্রি অনুসন্ধান করুন"
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {/* Period filter dropdown — opens bottom sheet */}
          <TouchableOpacity
            style={{ flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:12, paddingVertical:11, borderLeftWidth:1, borderLeftColor:'rgba(255,255,255,0.22)' }}
            onPress={openSheet}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:'#fff' }}>{curLbl}</Text>
            <Feather name="chevron-down" size={14} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>

        {/* Type filter tabs — সব / আপনি দিয়েছেন / আপনি পেয়েছেন */}
        <View style={{ flexDirection:'row', gap:6, marginTop:10 }}>
          {([ 
            { key:'all'  as const, label:'সব' },
            { key:'gave' as const, label:'আপনি দিয়েছেন' },
            { key:'got'  as const, label:'আপনি পেয়েছেন' },
          ]).map(tab => {
            const active = typeFilter === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={{
                  paddingHorizontal:11, paddingVertical:6, borderRadius:20,
                  backgroundColor: active ? '#fff' : 'rgba(255,255,255,0.15)',
                  borderWidth:1,
                  borderColor: active ? '#fff' : 'rgba(255,255,255,0.28)',
                }}
                onPress={() => { Haptics.selectionAsync(); setTypeFilter(tab.key); }}
                activeOpacity={0.72}
              >
                <Text style={{ fontSize:12, fontFamily:'Inter_600SemiBold', color: active ? PRIMARY : 'rgba(255,255,255,0.92)' }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom:12 }}>

        {loading ? (
          <View style={{ padding:56, alignItems:'center' }}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        ) : (
          <>
            {/* ── Stats 2×2 ────────────────────────────────────────────────── */}
            <View style={{ paddingHorizontal:12, paddingTop:12, gap:8 }}>
              <View style={{ flexDirection:'row', gap:8 }}>
                {/* মোট ব্যালেন্স */}
                <View style={[sc.card, { borderLeftColor: isGet ? colors.willGet : colors.willGive }]}>
                  <Text style={sc.lbl}>মোট ব্যালেন্স</Text>
                  <Text style={[sc.val, { color: isGet ? colors.willGet : colors.willGive }]}>{fmtCur(Math.abs(net))}</Text>
                  <Text style={sc.sub}>{isGet ? '↑ পাবেন' : '↓ দেবেন'}</Text>
                </View>
                {/* মোট এন্ট্রি সংখ্যা */}
                <View style={[sc.card, { borderLeftColor:PRIMARY }]}>
                  <Text style={sc.lbl}>মোট এন্ট্রি সংখ্যা</Text>
                  <Text style={[sc.val, { color:PRIMARY }]}>{toBn(filtered.length)}</Text>
                  <Text style={sc.sub}>টি লেনদেন</Text>
                </View>
              </View>
              <View style={{ flexDirection:'row', gap:8 }}>
                {/* আপনি দিয়েছেন */}
                <View style={[sc.card, { borderLeftColor:colors.willGet }]}>
                  <Text style={sc.lbl}>আপনি দিয়েছেন</Text>
                  <Text style={[sc.val, { color:colors.willGet }]}>{fmtCur(gave)}</Text>
                </View>
                {/* আপনি পেয়েছেন */}
                <View style={[sc.card, { borderLeftColor:colors.willGive }]}>
                  <Text style={sc.lbl}>আপনি পেয়েছেন</Text>
                  <Text style={[sc.val, { color:colors.willGive }]}>{fmtCur(received)}</Text>
                </View>
              </View>
            </View>

            {/* ── Section header ───────────────────────────────────────────── */}
            <View style={{ paddingHorizontal:16, paddingTop:14, paddingBottom:8, flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
              <Text style={{ fontSize:12, fontFamily:'Inter_600SemiBold', color:'#64748B', textTransform:'uppercase', letterSpacing:0.5 }}>
                লেনদেনের তালিকা
              </Text>
              <Text style={{ fontSize:12, fontFamily:'Inter_500Medium', color:'#94A3B8' }}>
                {toBn(filtered.length)} টি
              </Text>
            </View>

            {/* ── Entry list ───────────────────────────────────────────────── */}
            <View style={ec.card}>
              {filtered.length === 0 ? (
                <View style={{ alignItems:'center', paddingVertical:44 }}>
                  <Feather name="inbox" size={42} color="#CBD5E1" />
                  <Text style={{ color:'#94A3B8', fontFamily:'Inter_400Regular', fontSize:14, marginTop:10 }}>
                    {query.trim() ? 'কোনো মিল পাওয়া যায়নি' : 'এই সময়কালে কোনো লেনদেন নেই'}
                  </Text>
                </View>
              ) : (
                filtered.map((entry, idx) => {
                  const isGave  = entry.type === 'YOU_GAVE';
                  const accent  = isGave ? colors.willGet : colors.willGive;
                  return (
                    <View key={entry.id} style={[ec.row, idx === filtered.length-1 && { borderBottomWidth:0 }]}>
                      <View style={[ec.dot, { backgroundColor:accent }]} />
                      <View style={{ flex:1 }}>
                        <Text style={ec.desc} numberOfLines={2}>
                          {entry.description || (isGave ? 'আপনি দিয়েছেন' : 'আপনি পেয়েছেন')}
                        </Text>
                        <Text style={ec.meta}>{fmtDateStr(entry.createdAt)} · {fmtTimeStr(entry.createdAt)}</Text>
                        <Text style={{ fontSize:11, fontFamily:'Inter_600SemiBold', color:accent, marginTop:1 }}>
                          {isGave ? '▲ দিয়েছেন' : '▼ পেয়েছেন'}
                        </Text>
                      </View>
                      {/* Amount + running balance */}
                      <View style={{ alignItems:'flex-end' }}>
                        <Text style={[ec.amt, { color:accent }]}>
                          {isGave ? '+' : '-'}{fmtCur(entry.amount)}
                        </Text>
                        {(() => {
                          const bal = runningBalances.get(entry.id) ?? 0;
                          const bc  = bal >= 0 ? colors.willGet : colors.willGive;
                          return (
                            <Text style={{ fontSize:10, color:bc, fontFamily:'Inter_500Medium', marginTop:2 }}>
                              ব্যালেন্স: {fmtCur(Math.abs(bal))}
                            </Text>
                          );
                        })()}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════════════
          STICKY BOTTOM BAR
          ══════════════════════════════════════════════════════════════════════ */}
      <View style={[bb.bar, { paddingBottom: Platform.OS==='ios' ? insets.bottom + 10 : 16 }]}>

        {/* Left: Outline PDF button */}
        <TouchableOpacity
          style={[bb.pdfBtn, pdfBusy && { opacity:0.6 }]}
          onPress={handlePdf}
          disabled={pdfBusy || shareBusy}
          activeOpacity={0.82}
        >
          {pdfBusy
            ? <ActivityIndicator size="small" color={PRIMARY} />
            : <Feather name="file-text" size={17} color={PRIMARY} />
          }
          <Text style={[bb.pdfTxt, { color:PRIMARY }]}>
            {pdfBusy ? 'তৈরি হচ্ছে…' : 'PDF ডাউনলোড'}
          </Text>
        </TouchableOpacity>

        {/* Right: Filled share button */}
        <TouchableOpacity
          style={[bb.shareBtn, { backgroundColor:PRIMARY }, shareBusy && { opacity:0.6 }]}
          onPress={handleShare}
          disabled={pdfBusy || shareBusy}
          activeOpacity={0.85}
        >
          {shareBusy
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="share-2" size={17} color="#fff" />
          }
          <Text style={bb.shareTxt}>
            {shareBusy ? 'তৈরি হচ্ছে…' : 'শেয়ার করুন'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Date picker popup */}
      <DatePopup
        visible={datePop !== null}
        label={datePop==='start' ? 'আরম্ভের তারিখ নির্বাচন করুন' : 'শেষের তারিখ নির্বাচন করুন'}
        date={datePop==='start' ? disp.start : disp.end}
        onConfirm={onDateConfirm}
        onClose={() => setDatePop(null)}
      />

      {/* Filter bottom sheet */}
      <FilterSheet
        visible={sheetOpen}
        pendingFilter={pFilter}  setPendingFilter={setPFilter}
        pendingStart={pStart}    pendingEnd={pEnd}
        setPendingStart={setPStart} setPendingEnd={setPEnd}
        onApply={applySheet}    onClose={closeSheet}
        anim={anim}             primary={PRIMARY}
        bottomInset={insets.bottom}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Shared StyleSheet atoms ──────────────────────────────────────────────────

const sc = StyleSheet.create({
  card: { flex:1, backgroundColor:'#fff', borderRadius:12, padding:14, borderLeftWidth:4, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:4, elevation:2 },
  lbl:  { fontSize:11, fontFamily:'Inter_500Medium', color:'#64748B', marginBottom:5 },
  val:  { fontSize:20, fontFamily:'Inter_700Bold' },
  sub:  { fontSize:11, fontFamily:'Inter_400Regular', color:'#94A3B8', marginTop:2 },
});

const ec = StyleSheet.create({
  card: { backgroundColor:'#fff', marginHorizontal:12, borderRadius:12, overflow:'hidden', marginBottom:8, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:4, elevation:2 },
  row:  { flexDirection:'row', alignItems:'flex-start', paddingVertical:13, paddingHorizontal:14, borderBottomWidth:1, borderBottomColor:'#F1F5F9' },
  dot:  { width:8, height:8, borderRadius:4, marginTop:5, marginRight:10 },
  desc: { fontSize:13, fontFamily:'Inter_500Medium', color:'#1E293B' },
  meta: { fontSize:11, color:'#94A3B8', fontFamily:'Inter_400Regular', marginTop:2 },
  amt:  { fontSize:15, fontFamily:'Inter_700Bold', textAlign:'right' },
});

const bb = StyleSheet.create({
  bar:      { flexDirection:'row', gap:10, paddingHorizontal:14, paddingTop:10, backgroundColor:'#fff', borderTopWidth:1, borderTopColor:'#E2E8F0' },
  // Outline PDF button
  pdfBtn:   { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:7, paddingVertical:14, borderRadius:11, borderWidth:2, borderColor:'#004B93', backgroundColor:'#fff' },
  pdfTxt:   { fontSize:14, fontFamily:'Inter_700Bold' },
  // Filled share button
  shareBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:7, paddingVertical:14, borderRadius:11 },
  shareTxt: { fontSize:14, fontFamily:'Inter_700Bold', color:'#fff' },
});
