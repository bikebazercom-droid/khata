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
import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { assertPdfFile, reportPdfName, shareReportPdf, saveReportPdfToFolder, FolderPdfError } from '@/lib/report-pdf';
import * as Haptics from 'expo-haptics';
import {
  useGetParty,
  useListLedgerEntries,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
} from '@workspace/api-client-react';
import type { LedgerEntry } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useAuthRole } from '@/lib/auth-role';
import { Redirect } from 'expo-router';

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
// "18 Jul 26" — short row date matching screenshot
const ROW_MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtRowDate = (d: string) => {
  const dt = new Date(d);
  return `${dt.getDate()} ${ROW_MO[dt.getMonth()]} ${String(dt.getFullYear()).slice(-2)}`;
};

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

const PDF_MONTHS_BN = [
  'জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন',
  'জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর',
];

function buildHtml(opts: {
  partyName: string;
  partyPhone?: string | null;
  filterLbl: string;
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
  entries: LedgerEntry[];
  gave: number;
  received: number;
  net: number;
  openingBalance: number;
  entryCount: number;
}): string {
  // ── amount formatters ──────────────────────────────────────────────────────
  const fmtA = (n: number) =>
    Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // positive = party owes you (Dr), negative = you owe party (Cr)
  const fmtB = (n: number) => `${fmtA(n)} ${n >= 0 ? 'Dr' : 'Cr'}`;
  const clr  = (n: number) => n >= 0 ? '#b91c1c' : '#166534';

  // ── date helpers ───────────────────────────────────────────────────────────
  const dayLabel = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    return `${dd} ${PDF_MONTHS_BN[d.getMonth()]} ${d.getFullYear()}`;
  };
  const shortDate = (d: Date) =>
    `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;

  const now = new Date();
  const footerTime = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  const footerDate = `${now.getDate()} ${PDF_MONTHS_BN[now.getMonth()]}'${String(now.getFullYear()).slice(-2)}`;

  // ── period string ──────────────────────────────────────────────────────────
  const periodStr = (opts.rangeStart && opts.rangeEnd)
    ? `${dayLabel(opts.rangeStart)} - ${dayLabel(opts.rangeEnd)}`
    : opts.filterLbl;
  const openDateStr = opts.rangeStart ? dayLabel(opts.rangeStart) : null;

  // ── table rows ─────────────────────────────────────────────────────────────
  const sorted = [...opts.entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  let tableRows = '';
  let runBal    = opts.openingBalance;
  let lastDay   = '';
  let isFirst   = true;

  for (const e of sorted) {
    const d      = new Date(e.createdAt);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const isGave = e.type === 'YOU_GAVE';
    runBal += isGave ? e.amount : -e.amount;

    if (dayKey !== lastDay) {
      const openNote = isFirst
        ? `<td style="border:0;text-align:right;color:#64748b;font-size:11px;padding:7px 10px;white-space:nowrap;">(ওপেনিং ব্যালেন্স: ${fmtA(opts.openingBalance)})</td>`
        : '<td style="border:0;"></td>';
      tableRows += `<tr style="background:#f1f5f9;">
        <td colspan="4" style="padding:0;border:1px solid #cbd5e1;">
          <table style="width:100%;border-collapse:collapse;"><tr>
            <td style="border:0;padding:7px 10px;font-weight:700;font-size:12px;">${dayLabel(d)}</td>
            ${openNote}
          </tr></table>
        </td>
      </tr>`;
      lastDay = dayKey;
      isFirst = false;
    }

    const dCell = isGave
      ? `<td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;background:#fef2f2;font-size:12px;">${fmtA(e.amount)}</td>`
      : '<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#fef2f2;"></td>';
    const cCell = isGave
      ? '<td style="padding:7px 10px;border:1px solid #e2e8f0;background:#f0fdf4;"></td>'
      : `<td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;background:#f0fdf4;font-size:12px;">${fmtA(e.amount)}</td>`;

    tableRows += `<tr>
      <td style="padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;">${shortDate(d)}</td>
      ${dCell}${cCell}
      <td style="padding:7px 10px;border:1px solid #e2e8f0;text-align:right;font-size:12px;font-weight:600;color:${clr(runBal)};">${fmtB(runBal)}</td>
    </tr>`;
  }

  if (!tableRows) {
    tableRows = `<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8;border:1px solid #e2e8f0;">কোনো লেনদেন নেই</td></tr>`;
  }

  // totals: gave→ডেবিট, received→ক্রেডিট
  tableRows += `<tr style="background:#f8fafc;font-weight:700;">
    <td style="padding:8px 10px;border:1px solid #cbd5e1;font-size:12px;">সর্বমোট</td>
    <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;background:#fef2f2;font-size:12px;">${fmtA(opts.gave)}</td>
    <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;background:#f0fdf4;font-size:12px;">${fmtA(opts.received)}</td>
    <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:${clr(opts.net)};">${fmtB(opts.net)}</td>
  </tr>`;

  const partyRelation = opts.net >= 0 ? `${opts.partyName} দেবে` : `${opts.partyName} পাবে`;

  // ── final HTML ─────────────────────────────────────────────────────────────
  return `<!DOCTYPE html><html lang="bn"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans Bengali',Arial,sans-serif;background:#e8ecf1;color:#1e293b;padding:24px 0 40px}
  .page{background:#fff;width:740px;margin:0 auto;box-shadow:0 2px 16px rgba(0,0,0,.15)}
</style>
</head><body>
<div class="page">

  <!-- Navy header -->
  <div style="background:#003366;display:flex;justify-content:space-between;align-items:center;padding:14px 22px;color:#fff;">
    <span style="font-size:16px;font-weight:700;">${opts.partyName}</span>
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:20px;">📒</span>
      <span style="font-size:15px;font-weight:700;">বাংলা খাতা</span>
    </div>
  </div>

  <div style="padding:26px 28px;">

    <!-- Title -->
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:18px;font-weight:700;color:#1e293b;">${opts.partyName} এর স্টেটমেন্ট</div>
      ${opts.partyPhone ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">ফোন নম্বর: ${opts.partyPhone}</div>` : ''}
      <div style="font-size:12px;color:#64748b;margin-top:3px;">(${periodStr})</div>
    </div>

    <!-- 4-column summary box -->
    <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;margin-bottom:18px;">
      <tr>
        <td style="padding:12px 14px;border-right:1px solid #cbd5e1;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">ওপেনিং ব্যালেন্স</div>
          <div style="font-size:15px;font-weight:700;color:${clr(opts.openingBalance)};">৳${fmtA(opts.openingBalance)}</div>
          ${openDateStr ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;">(on ${openDateStr})</div>` : ''}
        </td>
        <td style="padding:12px 14px;border-right:1px solid #cbd5e1;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট খরচ(-)</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">৳${fmtA(opts.gave)}</div>
        </td>
        <td style="padding:12px 14px;border-right:1px solid #cbd5e1;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট জমা(+)</div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;">৳${fmtA(opts.received)}</div>
        </td>
        <td style="padding:12px 14px;width:25%;vertical-align:top;">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px;">মোট ব্যালেন্স</div>
          <div style="font-size:15px;font-weight:700;color:${clr(opts.net)};">৳${fmtB(opts.net)}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:3px;">(${partyRelation})</div>
        </td>
      </tr>
    </table>

    <!-- Entry count -->
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#374151;">
      এন্ট্রির সংখ্যা: ${opts.entryCount} (${opts.filterLbl})
    </div>

    <!-- Transaction table -->
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:left;font-size:12px;color:#374151;font-weight:700;width:18%;">তারিখ</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;background:#fef2f2;width:26%;">ডেবিট (-)</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;background:#f0fdf4;width:26%;">ক্রেডিট (+)</th>
          <th style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-size:12px;color:#374151;font-weight:700;width:30%;">ব্যালেন্স</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <!-- Footer line -->
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:6px;">
      <span>রিপোর্ট তৈরি হয়েছে : ${footerTime} | ${footerDate}</span>
      <span>Page 1 of 1</span>
    </div>

  </div>

  <!-- Bottom navy banner -->
  <div style="background:#003366;color:#fff;padding:12px 22px;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span>এখনই বাংলা খাতা ব্যবহার শুরু করুন</span>
      <span style="background:#fff;color:#003366;padding:3px 10px;font-weight:700;border-radius:3px;font-size:11px;">ইনস্টল করুন</span>
    </div>
    <div style="text-align:right;font-size:11px;opacity:0.85;">
      ${opts.partyPhone ? `📞 ${opts.partyPhone}<br/>` : ''}নিয়ম ও শর্তাবলী প্রযোজ্য
    </div>
  </div>

</div>
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
  const { identity } = useAuthRole();

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

  // Data
  const { data:party, isLoading:pL } = useGetParty(id!, {
    query: { enabled: identity?.role === 'owner', queryKey: getGetPartyQueryKey(id!) },
  });
  const { data:entries=[], isLoading:eL } = useListLedgerEntries(id!, {
    query: { enabled: identity?.role === 'owner', queryKey: getListLedgerEntriesQueryKey(id!) },
  });
  if (identity?.role === 'staff') return <Redirect href="/" />;

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

  // Filtered by search only (no type filter — matches screenshot)
  const filtered = useMemo(() => {
    if (!query.trim()) return dateFiltered;
    const q = query.toLowerCase();
    return dateFiltered.filter(e => (e.description??'').toLowerCase().includes(q));
  }, [dateFiltered, query]);

  // Totals (always over the full date-filtered set, not type-filtered)
  const gave     = useMemo(() => dateFiltered.filter(e=>e.type==='YOU_GAVE').reduce((s,e)=>s+e.amount,0), [dateFiltered]);
  const received = useMemo(() => dateFiltered.filter(e=>e.type==='YOU_GOT').reduce((s,e)=>s+e.amount,0), [dateFiltered]);
  const net      = useMemo(() => gave - received, [gave, received]);
  const isGet    = party ? party.balanceType === 'YOU_WILL_GET' : net > 0;

  // Opening balance = sum of all entries strictly before the current date range
  const openingBalance = useMemo(() => {
    const r = getRange(filter, cStart, cEnd);
    if (!r) return 0;
    return entries
      .filter(e => new Date(e.createdAt).getTime() < r.start.getTime())
      .reduce((s, e) => s + (e.type === 'YOU_GAVE' ? e.amount : -e.amount), 0);
  }, [entries, filter, cStart, cEnd]);

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

  // PDF generation saves an app-private copy; the share sheet offers external destinations.
  const [pdfBusy,   setPdfBusy]   = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const folderInProgress = useRef(false);

  const getHtml = useCallback(() => {
    const r = getRange(filter, cStart, cEnd);
    return buildHtml({
      partyName: party?.name ?? '',
      partyPhone: party?.phone,
      filterLbl: filterLabel(filter, cStart, cEnd),
      rangeStart: r?.start ?? null,
      rangeEnd:   r?.end   ?? null,
      entries:    dateFiltered,          // all date-filtered entries (not search-filtered)
      gave, received, net,
      openingBalance,
      entryCount: dateFiltered.length,
    });
  }, [party, filter, cStart, cEnd, dateFiltered, gave, received, net, openingBalance]);

  // Shared helper — generates the PDF and returns its local URI
  async function generatePdfUri(): Promise<string> {
    const { uri: tmpUri } = await Print.printToFileAsync({ html: getHtml(), base64: false });
    const generated = new File(tmpUri);
    assertPdfFile(generated);
    // Copy into the documents directory so the file persists after the temp cache is cleared.
    const destination = new File(Paths.document, reportPdfName(id, party?.name ?? 'report'));
    // iOS does not overwrite an existing file when copying; replace the previous report.
    if (destination.exists) destination.delete();
    generated.copy(destination);
    assertPdfFile(destination);
    return destination.uri;
  }

  async function shareSavedPdf(savedUri: string) {
    const result = await shareReportPdf(savedUri, new File(savedUri), Sharing);
    if (result === 'unavailable') {
      Alert.alert('শেয়ার করা যাচ্ছে না', 'এই ডিভাইসে শেয়ারিং সমর্থিত নয়।');
    }
  }

  function offerFolderSave(savedUri: string) {
    if (Platform.OS !== 'android') return;
    Alert.alert(
      'ফোল্ডারে PDF সেভ',
      'পরের পর্দায় একটি ফোল্ডার বেছে নিয়ে “Use this folder” / অনুমতি দিন চাপুন। Android ১১ বা পরের সংস্করণে মূল Downloads, ফোন বা SD কার্ডের মূল ফোল্ডার বাছা নাও যেতে পারে। Downloads-এর ভেতরে “বাংলা খাতা” নামে সাবফোল্ডার তৈরি করে বা অন্য অনুমোদিত সাবফোল্ডার বেছে নিন। সর্বোচ্চ ১০ MiB PDF সেভ করা যাবে।',
      [
        { text: 'বাতিল', style: 'cancel' },
        {
          text: 'ফোল্ডার বাছুন',
          onPress: async () => {
            if (folderInProgress.current) return;
            folderInProgress.current = true;
            setPdfBusy(true);
            try {
              const result = await saveReportPdfToFolder(
                Platform.OS, savedUri, new File(savedUri), id, party?.name ?? 'report',
                {
                  ...LegacyFileSystem.StorageAccessFramework,
                  getInfoAsync: LegacyFileSystem.getInfoAsync,
                },
              );
              if (result === 'saved') {
                Alert.alert('ফোল্ডারে সেভ হয়েছে', 'নির্বাচিত ফোল্ডারে PDF কপি লেখা সম্পন্ন হয়েছে। Files অ্যাপে দেখুন। একই নাম থাকলে ফাইল সেবা নতুন নাম দিতে পারে।');
              } else if (result === 'not-granted') {
                Alert.alert('ফোল্ডারে সেভ হয়নি', 'ফোল্ডার বাছা বাতিল হয়েছে বা অনুমতি দেওয়া হয়নি। অ্যাপের নিজস্ব PDF কপি অক্ষত আছে। আবার “PDF ডাউনলোড” → “ফোল্ডারে সেভ” থেকে চেষ্টা করতে পারেন।');
              }
            } catch (error) {
              Alert.alert('ফোল্ডারে সেভ হয়নি', error instanceof FolderPdfError
                ? error.message
                : 'সেভ করা PDF পড়া যায়নি। “PDF ডাউনলোড” দিয়ে আবার তৈরি করুন।');
            } finally {
              folderInProgress.current = false;
              setPdfBusy(false);
            }
          },
        },
      ],
    );
  }

  async function handlePdf() {
    if (!party || folderInProgress.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPdfBusy(true);
    try {
      const savedUri = await generatePdfUri();
      // Notify the user and offer to open / share immediately
      Alert.alert(
        'PDF সংরক্ষিত হয়েছে ✓',
        Platform.OS === 'android'
          ? 'রিপোর্টটি অ্যাপের নিজস্ব স্টোরেজে সেভ হয়েছে। বাইরে কপি রাখতে “ফোল্ডারে সেভ” অথবা পাঠাতে “শেয়ার করুন” চাপুন।'
          : 'রিপোর্টটি অ্যাপের নিজস্ব স্টোরেজে সেভ হয়েছে। বাইরে সেভ করতে বা পাঠাতে “শেয়ার করুন” চাপুন।',
        [
          ...(Platform.OS === 'android' ? [{
            text: 'ফোল্ডারে সেভ',
            onPress: () => offerFolderSave(savedUri),
          }] : []),
          {
            text: 'শেয়ার করুন',
            onPress: async () => {
              setShareBusy(true);
              try {
                await shareSavedPdf(savedUri);
              } catch {
                Alert.alert('ত্রুটি', 'শেয়ার করা যায়নি।');
              } finally {
                setShareBusy(false);
              }
            },
          },
          { text: 'ঠিক আছে', style: 'cancel' },
        ],
      );
    } catch {
      Alert.alert('ত্রুটি', 'PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleShare() {
    if (!party || folderInProgress.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShareBusy(true);
    try {
      const savedUri = await generatePdfUri();
      await shareSavedPdf(savedUri);
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

      </View>
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom:12 }}>

        {loading ? (
          <View style={{ padding:56, alignItems:'center' }}>
            <ActivityIndicator size="large" color={PRIMARY} />
          </View>
        ) : (
          <>
            {/* ── Stats — মোট ব্যালেন্স row + 3-col sub-row ─────────────── */}
            <View style={{ paddingHorizontal:14, paddingTop:14, paddingBottom:2 }}>
              {/* Row 1: মোট ব্যালেন্স */}
              <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <Text style={{ fontSize:15, fontFamily:'Inter_600SemiBold', color:'#1E293B' }}>মোট ব্যালেন্স</Text>
                <Text style={{ fontSize:18, fontFamily:'Inter_700Bold', color: isGet ? colors.willGet : colors.willGive }}>
                  {fmtCur(Math.abs(net))}
                </Text>
              </View>
              {/* Divider */}
              <View style={{ height:1, backgroundColor:'#E2E8F0', marginBottom:10 }} />
              {/* Row 2: 3-column sub-stats */}
              <View style={{ flexDirection:'row', alignItems:'flex-start' }}>
                {/* মোট */}
                <View style={{ flex:1 }}>
                  <Text style={{ fontSize:11, fontFamily:'Inter_400Regular', color:'#64748B' }}>মোট</Text>
                  <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:'#1E293B', marginTop:2 }}>
                    {toBn(filtered.length)} এন্ট্রিগুলো
                  </Text>
                </View>
                {/* আপনি দিয়েছেন */}
                <View style={{ flex:1, alignItems:'center' }}>
                  <Text style={{ fontSize:11, fontFamily:'Inter_400Regular', color:'#64748B' }}>আপনি দিয়েছেন</Text>
                  <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:colors.willGet, marginTop:2 }}>
                    {fmtCur(gave)}
                  </Text>
                </View>
                {/* আপনি পেয়েছেন */}
                <View style={{ flex:1, alignItems:'flex-end' }}>
                  <Text style={{ fontSize:11, fontFamily:'Inter_400Regular', color:'#64748B' }}>আপনি</Text>
                  <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:colors.willGive, marginTop:2 }}>
                    {fmtCur(received)}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Entry list — 3-column layout matching screenshot ─────────── */}
            <View style={{ marginHorizontal:14, marginTop:10, marginBottom:8, borderRadius:12, overflow:'hidden', backgroundColor:'#fff', shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:4, elevation:2 }}>
              {filtered.length === 0 ? (
                <View style={{ alignItems:'center', paddingVertical:44 }}>
                  <Feather name="inbox" size={42} color="#CBD5E1" />
                  <Text style={{ color:'#94A3B8', fontFamily:'Inter_400Regular', fontSize:14, marginTop:10 }}>
                    {query.trim() ? 'কোনো মিল পাওয়া যায়নি' : 'এই সময়কালে কোনো লেনদেন নেই'}
                  </Text>
                </View>
              ) : (
                filtered.map((entry, idx) => {
                  const isGave = entry.type === 'YOU_GAVE';
                  const bal    = runningBalances.get(entry.id) ?? 0;
                  const rowBg  = idx % 2 === 1 ? '#FEF2F2' : '#fff';
                  return (
                    <View
                      key={entry.id}
                      style={{
                        flexDirection:'row', alignItems:'center',
                        paddingVertical:12, paddingHorizontal:14,
                        backgroundColor:rowBg,
                        borderBottomWidth: idx < filtered.length - 1 ? 1 : 0,
                        borderBottomColor:'#F1F5F9',
                      }}
                    >
                      {/* LEFT: date + balance badge */}
                      <View style={{ flex:1.1 }}>
                        <Text style={{ fontSize:13, fontFamily:'Inter_600SemiBold', color:'#1E293B' }}>
                          {fmtRowDate(entry.createdAt)}
                        </Text>
                        <View style={{ marginTop:4, backgroundColor:'#F1F5F9', borderRadius:6, paddingHorizontal:6, paddingVertical:2, alignSelf:'flex-start' }}>
                          <Text style={{ fontSize:10, fontFamily:'Inter_500Medium', color:'#64748B' }}>
                            ব্যালেন্স {fmtCur(Math.abs(bal))}
                          </Text>
                        </View>
                      </View>

                      {/* MIDDLE: আপনি দিয়েছেন amount (red) or empty */}
                      <View style={{ flex:1, alignItems:'center' }}>
                        {isGave && (
                          <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:colors.willGet }}>
                            {fmtCur(entry.amount)}
                          </Text>
                        )}
                      </View>

                      {/* RIGHT: আপনি পেয়েছেন amount (green) or empty */}
                      <View style={{ flex:1, alignItems:'flex-end' }}>
                        {!isGave && (
                          <Text style={{ fontSize:13, fontFamily:'Inter_700Bold', color:colors.willGive }}>
                            {fmtCur(entry.amount)}
                          </Text>
                        )}
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


const bb = StyleSheet.create({
  bar:      { flexDirection:'row', gap:10, paddingHorizontal:14, paddingTop:10, backgroundColor:'#fff', borderTopWidth:1, borderTopColor:'#E2E8F0' },
  // Outline PDF button
  pdfBtn:   { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:7, paddingVertical:14, borderRadius:11, borderWidth:2, borderColor:'#004B93', backgroundColor:'#fff' },
  pdfTxt:   { fontSize:14, fontFamily:'Inter_700Bold' },
  // Filled share button
  shareBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:7, paddingVertical:14, borderRadius:11 },
  shareTxt: { fontSize:14, fontFamily:'Inter_700Bold', color:'#fff' },
});
