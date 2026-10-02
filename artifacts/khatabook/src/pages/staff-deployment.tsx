/**
 * Staff Duty Deployment & Rotation Module
 *
 * Completely isolated from customer ledger / financial accounting.
 * Uses raw fetch + react-query directly — no generated API client coupling.
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBusinessContext } from '@/lib/businessContext';
import {
  ChevronLeft,
  UserPlus2,
  FolderOpen,
  Trash2,
  MapPin,
  FileDown,
  Loader2,
  Users,
  CalendarDays,
  ArrowDown,
  Pencil,
  Clock,
  SendHorizontal,
  PlusCircle,
  ListChecks,
} from 'lucide-react';
import { format, isToday, parseISO } from 'date-fns';
import { bn } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { SettingsDrawer } from '@/components/modals/settings-drawer';

// ── constants ─────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

// Cycling colour palette for dynamic destination badges
const PALETTE = [
  { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
  { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200' },
  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200' },
  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200' },
] as const;

const FALLBACK_COLOR = { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' };

function destColor(name: string, allDests: StaffDestination[]) {
  const idx = allDests.findIndex(d => d.name === name);
  if (idx < 0) return FALLBACK_COLOR;
  return PALETTE[idx % PALETTE.length];
}

// ── types ─────────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string;
  name: string;
  queueOrder: number;
  createdAt: string;
}

interface DeploymentLog {
  id: string;
  staffId: string | null;
  staffName: string;
  destination: string;
  deployedAt: string;
}

interface StaffDestination {
  id: string;
  name: string;
  createdAt: string;
}

// ── keyboard height hook ──────────────────────────────────────────────────────

/**
 * Tracks the height (px) of the on-screen virtual keyboard using the
 * VisualViewport API. Returns 0 when no keyboard is visible.
 *
 * How it works:
 *   window.innerHeight  = full layout viewport (unchanged when keyboard opens)
 *   visualViewport.height = visible area above the keyboard
 *   difference          = keyboard height
 *
 * We also subtract visualViewport.offsetTop (scroll offset on some browsers)
 * so the value is always the true keyboard clearance needed.
 */
function useKeyboardHeight(): number {
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const height = window.innerHeight - vv!.height - vv!.offsetTop;
      setKbHeight(Math.max(0, Math.round(height)));
    }

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update(); // read initial state

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return kbHeight;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function groupLogsByDate(logs: DeploymentLog[]): Map<string, DeploymentLog[]> {
  const map = new Map<string, DeploymentLog[]>();
  for (const log of logs) {
    const key = format(parseISO(log.deployedAt), 'yyyy-MM-dd');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(log);
  }
  return map;
}

function formatBanglaDate(dateStr: string): string {
  return format(parseISO(dateStr), 'd MMMM, yyyy', { locale: bn });
}

function formatBanglaTime(dateStr: string): string {
  return format(parseISO(dateStr), 'hh:mm a');
}

function destinationTally(logs: DeploymentLog[]): Record<string, number> {
  return logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.destination] = (acc[l.destination] ?? 0) + 1;
    return acc;
  }, {});
}

// ── main component ────────────────────────────────────────────────────────────

export function StaffDeploymentPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { selectedBusinessId } = useBusinessContext();
  const businessFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (selectedBusinessId) headers.set('X-Business-Id', selectedBusinessId);
    return fetch(input, { ...init, headers });
  };

  // ── keyboard clearance (for Add Staff bottom sheet) ───────────────────────
  const keyboardHeight = useKeyboardHeight();

  // ── tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<'queue' | 'logs' | 'destinations'>('queue');

  // ── deploy modal ───────────────────────────────────────────────────────────
  const [deployTarget, setDeployTarget] = useState<StaffMember | null>(null);

  // ── edit log modal ─────────────────────────────────────────────────────────
  const [editLog, setEditLog] = useState<DeploymentLog | null>(null);
  const [customEditDest, setCustomEditDest] = useState('');

  // ── add staff ──────────────────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');

  // ── delete staff confirm ───────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);

  // ── add destination ────────────────────────────────────────────────────────
  const [newDestName, setNewDestName] = useState('');

  // ── delete destination confirm ─────────────────────────────────────────────
  const [deleteDestTarget, setDeleteDestTarget] = useState<StaffDestination | null>(null);

  // ── settings drawer ────────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);

  // ── PDF state ─────────────────────────────────────────────────────────────
  const [pdfMonth, setPdfMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [isExporting,    setIsExporting]    = useState(false);
  const [isExportingJpg, setIsExportingJpg] = useState(false);

  // ── queries ────────────────────────────────────────────────────────────────

  const { data: personnel = [], isLoading: personnelLoading } = useQuery<StaffMember[]>({
    queryKey: ['staff-personnel', selectedBusinessId],
    queryFn: async () => {
      const r = await businessFetch(`${BASE}/api/staff/personnel`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch personnel');
      return r.json();
    },
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<DeploymentLog[]>({
    queryKey: ['staff-logs', selectedBusinessId],
    queryFn: async () => {
      const r = await businessFetch(`${BASE}/api/staff/logs`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch logs');
      return r.json();
    },
  });

  const { data: destinations = [], isLoading: destinationsLoading } = useQuery<StaffDestination[]>({
    queryKey: ['staff-destinations', selectedBusinessId],
    queryFn: async () => {
      const r = await businessFetch(`${BASE}/api/staff/destinations`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch destinations');
      return r.json();
    },
  });

  // ── mutations ──────────────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await businessFetch(`${BASE}/api/staff/personnel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error('Failed to add staff');
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-personnel'] });
      setNewName('');
      setShowAdd(false);
      toast.success('স্টাফ যোগ করা হয়েছে');
    },
    onError: () => toast.error('স্টাফ যোগ করতে ব্যর্থ হয়েছে'),
  });

  const deployMutation = useMutation({
    mutationFn: async ({ id, destination }: { id: string; destination: string }) => {
      const r = await businessFetch(`${BASE}/api/staff/personnel/${id}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ destination }),
      });
      if (!r.ok) throw new Error('Failed to deploy');
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-personnel'] });
      qc.invalidateQueries({ queryKey: ['staff-logs'] });
      setDeployTarget(null);
      toast.success('ডিউটি লগ করা হয়েছে');
    },
    onError: () => toast.error('ডিউটি লগ করতে ব্যর্থ হয়েছে'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await businessFetch(`${BASE}/api/staff/personnel/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-personnel'] });
      setDeleteTarget(null);
      toast.success('স্টাফ সরানো হয়েছে');
    },
    onError: () => toast.error('স্টাফ সরাতে ব্যর্থ হয়েছে'),
  });

  const editLogMutation = useMutation({
    mutationFn: async ({ id, destination }: { id: string; destination: string }) => {
      const r = await businessFetch(`${BASE}/api/staff/logs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ destination }),
      });
      if (!r.ok) throw new Error('Failed to update log');
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-logs'] });
      setEditLog(null);
      setCustomEditDest('');
      toast.success('ডিউটি লোকেশন আপডেট হয়েছে');
    },
    onError: () => toast.error('আপডেট করতে ব্যর্থ হয়েছে'),
  });

  const addDestMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await businessFetch(`${BASE}/api/staff/destinations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? 'Failed to add destination');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-destinations'] });
      setNewDestName('');
      toast.success('গন্তব্য যোগ করা হয়েছে');
    },
    onError: (err: Error) => toast.error(err.message || 'গন্তব্য যোগ করতে ব্যর্থ হয়েছে'),
  });

  const deleteDestMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await businessFetch(`${BASE}/api/staff/destinations/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Failed to delete destination');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-destinations'] });
      setDeleteDestTarget(null);
      toast.success('গন্তব্য সরানো হয়েছে');
    },
    onError: () => toast.error('গন্তব্য সরাতে ব্যর্থ হয়েছে'),
  });

  // ── computed ───────────────────────────────────────────────────────────────

  const todayDeployed  = logs.filter(l => isToday(parseISO(l.deployedAt))).length;
  const queueRemaining = personnel.length;
  const logGroups      = groupLogsByDate(logs);

  // ── PDF export (iframe native print) ──────────────────────────────────────
  //
  // We abandoned html2pdf / html2canvas because they consistently produce
  // blank pages on mobile browsers due to stacking-context clipping and
  // compositor snapshot limitations that cannot be worked around at the
  // library level.
  //
  // The replacement uses the browser's own rendering engine:
  //   1. A hidden <iframe> is injected into document.body.
  //   2. A self-contained HTML document (fonts, print CSS, content) is
  //      written into the iframe via document.write().
  //   3. We wait for the iframe's fonts to decode, then call
  //      iframe.contentWindow.print() which opens the native OS print
  //      dialog. The user selects "Save as PDF" (all mobile browsers
  //      support this natively).
  //   4. The iframe is removed ~2 s later — enough time for the print
  //      spooler to hand off the document.
  //
  // Why this is bulletproof:
  //   • The iframe is a completely independent browsing context with its
  //     own DOM, CSSOM, and stacking context — zero interference from the
  //     React app's CSS (no overflow:hidden, no transforms, no clip).
  //   • The browser's print engine renders the same pixel pipeline it uses
  //     for real printing: backgrounds, Bengali glyphs, colours — all
  //     preserved exactly as the CSS declares.
  //   • `print-color-adjust: exact` (all vendor prefixes) forces Chrome /
  //     Safari to keep background colours in the PDF instead of stripping
  //     them for "ink saving" mode.

  async function handleExportPdf() {
    setIsExporting(true);
    const iframe = document.createElement('iframe');
    try {
      const [year, mon] = pdfMonth.split('-').map(Number);
      const monthLabel  = format(new Date(year, mon - 1, 1), 'MMMM yyyy', { locale: bn });

      // ── Step 1: fetch month logs ─────────────────────────────────────────
      const r = await businessFetch(`${BASE}/api/staff/logs?month=${pdfMonth}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      const monthLogs: DeploymentLog[] = await r.json();

      const tally  = destinationTally(monthLogs);
      const groups = groupLogsByDate(monthLogs);

      // ── Step 2: create a zero-size hidden iframe ─────────────────────────
      //
      // width/height:0 + visibility:hidden keeps it invisible.
      // We do NOT use display:none because print() on a display:none iframe
      // is a no-op in some browsers.
      Object.assign(iframe.style, {
        position:   'fixed',
        right:      '0',
        bottom:     '0',
        width:      '0',
        height:     '0',
        border:     '0',
        visibility: 'hidden',
      });
      document.body.appendChild(iframe);

      const iframeWin = iframe.contentWindow;
      if (!iframeWin) throw new Error('iframe contentWindow unavailable');
      const iframeDoc = iframeWin.document;

      // ── Step 3: write a complete, self-contained HTML document ───────────
      //
      // The document includes:
      //   • Google Fonts link for Noto Sans Bengali (the only Bengali-capable
      //     font available cross-browser without bundling a font file).
      //   • A @media print block with:
      //       - @page size:A4 and 10 mm margins
      //       - print-color-adjust:exact (all prefixes) so background colours
      //         are NOT stripped by Chrome's ink-saving heuristic
      //   • The full branded HTML produced by buildPdfHtml() — tables, header,
      //     summary strip, footer — all with inline styles so no external
      //     stylesheet is needed.
      const bodyContent = buildPdfHtml({ monthLabel, monthLogs, tally, groups, queueRemaining });

      iframeDoc.open();
      iframeDoc.write(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=794">
  <title>ডিউটি স্টেটমেন্ট — ${monthLabel}</title>
  <link
    href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700;900&family=Inter:wght@400;600;700;800;900&display=swap"
    rel="stylesheet"
  >
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Sans Bengali', 'Inter', Arial, sans-serif;
      background: #ffffff;
      color: #0f172a;
      padding: 20px;
    }
    @media print {
      @page {
        size: A4 portrait;
        margin: 10mm;
      }
      body {
        padding: 0;
        /* Force the browser to keep all background colours and images.
           Without this Chrome strips coloured table headers and pills. */
        -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
                     color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`);
      iframeDoc.close();

      // ── Step 4: wait for the iframe's fonts to decode ────────────────────
      //
      // The iframe has its own FontFaceSet. We must wait on the *iframe's*
      // document.fonts.ready — not the parent window's — because the Google
      // Fonts link was injected into the iframe document, not the parent.
      await iframeDoc.fonts.ready;

      // ── Step 5: double rAF inside the iframe ─────────────────────────────
      //
      // Same two-frame reason as before: frame 1 = layout, frame 2 = paint.
      // Using the iframe's own rAF keeps timing within the iframe's rendering
      // pipeline rather than the parent's, which may have a different cadence.
      await new Promise<void>(resolve =>
        iframeWin.requestAnimationFrame(() =>
          iframeWin.requestAnimationFrame(() => resolve()),
        ),
      );

      // ── Step 6: trigger the native print dialog ──────────────────────────
      //
      // focus() is required on iOS Safari — print() on an unfocused iframe
      // is silently swallowed on some versions.
      iframeWin.focus();
      iframeWin.print();

      // ── Step 7: deferred cleanup ─────────────────────────────────────────
      //
      // Removing the iframe immediately after print() cancels the spooler
      // job on some browsers before the OS has received the document.
      // A 2 s delay is enough for the handoff on all tested mobile browsers.
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 2_000);

      toast.success('প্রিন্ট ডায়ালগ খুলেছে — "PDF হিসেবে সেভ করুন" বেছে নিন');
    } catch (err) {
      console.error('[PDF export]', err);
      // On error remove immediately — no point keeping a broken iframe.
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      toast.error('PDF তৈরি করতে ব্যর্থ হয়েছে');
    } finally {
      setIsExporting(false);
    }
  }

  // ── Today's duty list → JPG (WhatsApp share) ──────────────────────────────
  //
  // Why position:fixed instead of position:absolute/left:-9999px:
  //   position:absolute at -9999px is off-screen in document coordinates.
  //   On mobile Chrome/Safari the compositor snapshot that html2canvas reads
  //   is clipped to the viewport — off-screen content returns a blank canvas.
  //
  //   position:fixed keeps the element in *viewport* coordinates. Moving it
  //   left by its own width (left:-${width}px) puts it just outside the
  //   visible area but still within the compositor's capture region.
  //   html2canvas captures it in full at the requested scale.
  //
  // Why a separate loading state (isExportingJpg):
  //   The PDF button has its own isExporting state; keeping them independent
  //   means tapping one button never disables the other.

  async function handleDownloadTodayJPG() {
    const todayLogs = logs.filter(l => isToday(parseISO(l.deployedAt)));

    if (todayLogs.length === 0) {
      toast.error('আজকে ডিউটিতে যাওয়ার কোনো তথ্য পাওয়া যায়নি!');
      return;
    }

    setIsExportingJpg(true);
    const CARD_WIDTH = 450;
    let container: HTMLDivElement | null = null;

    try {
      const todayDate = new Date().toLocaleDateString('bn-BD', {
        day: 'numeric', month: 'long', year: 'numeric',
      });

      // Build row markup using real field names from DeploymentLog
      const rowsHtml = todayLogs.map((log, index) => {
        const time = format(parseISO(log.deployedAt), 'hh:mm a');
        return `
          <div class="staff-row">
            <div class="staff-info">
              <div class="avatar-index">${index + 1}</div>
              <div class="staff-name">${log.staffName}</div>
            </div>
            <div>
              <div class="dest-badge">📍 ${log.destination}</div>
              <div class="time-badge">🕒 ${time}</div>
            </div>
          </div>`;
      }).join('');

      // ── Build container ──────────────────────────────────────────────────
      //
      // position:fixed; left:-${CARD_WIDTH}px keeps the element just outside
      // the left edge of the viewport — invisible to the user but fully
      // within the compositor's rendering region so html2canvas captures it.
      container = document.createElement('div');
      container.id = 'temp-jpg-export-container';
      Object.assign(container.style, {
        position:        'fixed',
        left:            `-${CARD_WIDTH + 20}px`,
        top:             '0',
        width:           `${CARD_WIDTH}px`,
        backgroundColor: '#ffffff',
        boxSizing:       'border-box',
        // font-family declared here so html2canvas picks it up as a
        // computed style on the root element.
        fontFamily:      "'Noto Sans Bengali', Arial, sans-serif",
      });

      // ── Inject styles + content ──────────────────────────────────────────
      //
      // We use a <style> tag (not @import) because html2canvas does not
      // process CSS @import rules. The Google Fonts <link> is appended to
      // document.head separately so the browser loads it before we wait on
      // document.fonts.ready.
      const fontLink = document.createElement('link');
      fontLink.rel  = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;700&display=swap';
      document.head.appendChild(fontLink);

      container.innerHTML = `
        <style>
          #temp-jpg-export-container * { box-sizing: border-box; margin: 0; padding: 0; }
          #temp-jpg-export-container {
            font-family: 'Noto Sans Bengali', Arial, sans-serif;
            padding: 30px;
          }
          .img-header {
            text-align: center;
            border-bottom: 2px dashed #d1d5db;
            padding-bottom: 15px;
            margin-bottom: 20px;
          }
          .img-title {
            font-size: 22px;
            font-weight: bold;
            color: #1e3a8a;
          }
          .img-subtitle {
            font-size: 13px;
            color: #4b5563;
            margin-top: 6px;
          }
          .staff-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #f3f4f6;
          }
          .staff-row:last-child { border-bottom: none; }
          .staff-info {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .avatar-index {
            background-color: #eff6ff;
            color: #1e40af;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            flex-shrink: 0;
          }
          .staff-name {
            font-size: 16px;
            font-weight: bold;
            color: #1f2937;
          }
          .dest-badge {
            font-size: 14px;
            font-weight: bold;
            color: #047857;
            background-color: #ecfdf5;
            padding: 4px 12px;
            border-radius: 9999px;
            white-space: nowrap;
          }
          .time-badge {
            font-size: 11px;
            color: #6b7280;
            margin-top: 3px;
            text-align: right;
          }
          .footer-note {
            text-align: center;
            margin-top: 25px;
            font-size: 11px;
            color: #9ca3af;
            border-top: 1px solid #f3f4f6;
            padding-top: 10px;
          }
        </style>
        <div class="img-header">
          <div class="img-title">আজকের ডিউটি তালিকা</div>
          <div class="img-subtitle">তারিখ: ${todayDate} | মোট ডিউটি: ${todayLogs.length} জন</div>
        </div>
        <div>${rowsHtml}</div>
        <div class="footer-note">Banglakhata • WhatsApp-এ শেয়ার করার জন্য তৈরি</div>
      `;

      document.body.appendChild(container);

      // ── Wait for fonts and two paint frames ─────────────────────────────
      await document.fonts.ready;
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      // ── Capture with html2canvas ─────────────────────────────────────────
      //
      // windowWidth:CARD_WIDTH — tells html2canvas to treat the capture as
      //   if the viewport is exactly as wide as our card.
      // scale:2.5 — 240 dpi equivalent; text stays crisp on mobile screens.
      // useCORS:true — needed for the Google Fonts stylesheet cross-origin.
      const h2c = (await import('html2canvas')).default;
      const canvas = await h2c(container, {
        scale:       2.5,
        useCORS:     true,
        backgroundColor: '#ffffff',
        windowWidth: CARD_WIDTH,
      });

      const fileName = `আজকের_ডিউটি_${new Date().toISOString().slice(0, 10)}.jpg`;

      // ── Fallback: standard <a> download ─────────────────────────────────
      //
      // Used on desktop browsers and any mobile browser that does not support
      // the Web Share API with files (e.g. Firefox Android < 93).
      const triggerDownload = () => {
        const link    = document.createElement('a');
        link.download = fileName;
        link.href     = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
        toast.success('JPG ডাউনলোড হয়েছে — WhatsApp-এ শেয়ার করুন');
      };

      // ── Primary: Web Share API with file ────────────────────────────────
      //
      // navigator.share({ files }) opens the OS native share sheet on
      // Android and iOS, letting the user pick WhatsApp (or any other app)
      // directly without leaving the browser.
      //
      // We must use toBlob (not toDataURL) because the Share API requires a
      // File object, which must be constructed from a Blob.
      //
      // AbortError means the user dismissed the share sheet — that is not an
      // error worth logging; we silently fall back to download instead.
      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.95),
      );

      if (!blob) throw new Error('canvas.toBlob() returned null');

      const file = new File([blob], fileName, { type: 'image/jpeg' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'আজকের ডিউটি তালিকা',
            text:  'আজকের ডিউটি তালিকা সরাসরি Banglakhata থেকে শেয়ার করা হলো।',
          });
          toast.success('শেয়ার সম্পন্ন হয়েছে!');
        } catch (shareErr: unknown) {
          // User dismissed the sheet — not a real error, just fall back.
          const cancelled =
            shareErr instanceof DOMException && shareErr.name === 'AbortError';
          if (!cancelled) console.warn('[JPG share]', shareErr);
          triggerDownload();
        }
      } else {
        // Desktop or browser without file-share support.
        triggerDownload();
      }

    } catch (err) {
      console.error('[JPG export]', err);
      toast.error('JPG তৈরি করতে ব্যর্থ হয়েছে');
    } finally {
      if (container && document.body.contains(container)) {
        document.body.removeChild(container);
      }
      setIsExportingJpg(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#f8fafc] relative">

      {/* ── Header ── */}
      <div className="shrink-0 bg-[#1B3A6B] z-10">
        <div className="flex items-center gap-3 px-4 pb-4 pt-[calc(1rem+var(--safe-top))]">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-white active:scale-95 transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-extrabold text-[16px] tracking-tight">ডিউটি ব্যবস্থাপনা</h1>
            <p className="text-white/60 text-[11px] font-medium mt-0.5">Staff Duty Deployment & Rotation</p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-white active:scale-95 transition-all"
          >
            <ListChecks className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-5 border-b border-white/15">
          <button
            onClick={() => setTab('queue')}
            className={cn(
              'text-[12px] font-bold pb-3 pt-1 transition-all border-b-2 whitespace-nowrap',
              tab === 'queue' ? 'text-white border-white' : 'text-white/55 border-transparent',
            )}
          >
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              ডিউটি লাইন
            </span>
          </button>
          <button
            onClick={() => setTab('logs')}
            className={cn(
              'text-[12px] font-bold pb-3 pt-1 transition-all border-b-2 whitespace-nowrap',
              tab === 'logs' ? 'text-white border-white' : 'text-white/55 border-transparent',
            )}
          >
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              লগ ফোল্ডার
            </span>
          </button>
          <button
            onClick={() => setTab('destinations')}
            className={cn(
              'text-[12px] font-bold pb-3 pt-1 transition-all border-b-2 whitespace-nowrap',
              tab === 'destinations' ? 'text-white border-white' : 'text-white/55 border-transparent',
            )}
          >
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              গন্তব্য তালিকা
            </span>
          </button>
        </div>
      </div>

      {/* ── Metrics strip ── */}
      <div className="shrink-0 grid grid-cols-2 divide-x divide-slate-200 bg-white border-b border-slate-200 shadow-sm">
        <div className="px-4 py-3 text-center">
          <p className="text-[#1B3A6B] font-extrabold text-xl">{todayDeployed}</p>
          <p className="text-[10px] font-semibold text-slate-400 mt-0.5">আজকে ডিউটিতে গেছেন</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-slate-800 font-extrabold text-xl">{queueRemaining}</p>
          <p className="text-[10px] font-semibold text-slate-400 mt-0.5">লাইনে বাকি আছেন</p>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain">

        {/* ════════════════ QUEUE TAB ════════════════ */}
        {tab === 'queue' && (
          <div className="px-4 pt-4 pb-28 space-y-3">

            {personnelLoading && (
              <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
              </div>
            )}

            {!personnelLoading && personnel.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <Users className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-slate-500 font-semibold text-[14px]">কোনো স্টাফ নেই</p>
                <p className="text-slate-400 text-[12px]">নিচের বাটনে ট্যাপ করে স্টাফ যোগ করুন</p>
              </div>
            )}

            {personnel.map((member, idx) => (
              <div key={member.id} className="relative">
                {/* Active target card */}
                {idx === 0 ? (
                  <div
                    onClick={() => setDeployTarget(member)}
                    className="w-full text-left bg-white rounded-2xl border-2 border-[#1B3A6B] shadow-md active:scale-[0.98] transition-all overflow-hidden cursor-pointer select-none"
                  >
                    {/* Active badge */}
                    <div className="bg-[#1B3A6B] px-4 py-2 flex items-center justify-between">
                      <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                        ✦ পরবর্তী ডিউটি লক্ষ্য
                      </span>
                      <span className="flex items-center gap-1 text-amber-300 text-[10px] font-bold">
                        <Clock className="w-3 h-3" />
                        অপেক্ষায় আছেন
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#1B3A6B]/10 flex items-center justify-center">
                          <span className="text-[#1B3A6B] font-extrabold text-[15px]">
                            {member.name.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-[16px]">{member.name}</p>
                          <p className="text-[11px] text-slate-400 font-medium">#১ — ডিউটি না দেওয়া পর্যন্ত এখানেই থাকবেন</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteTarget(member); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 active:scale-95 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <MapPin className="w-5 h-5 text-[#1B3A6B]" />
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Queue member card — tappable for manual override deploy */
                  <div
                    onClick={() => setDeployTarget(member)}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden cursor-pointer active:scale-[0.98] transition-all select-none"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <span className="text-slate-600 font-bold text-[13px]">
                          {member.name.charAt(0)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-[14px] truncate">{member.name}</p>
                        <p className="text-[11px] text-slate-400 font-medium">
                          #{idx + 1} —{' '}
                          <span className="text-[#1B3A6B]/60 font-semibold">ট্যাপ করে ম্যানুয়াল ডিউটি দিন</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteTarget(member); }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 active:scale-95 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <MapPin className="w-3.5 h-3.5 text-slate-300 mr-0.5" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Arrow connector */}
                {idx < personnel.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="w-4 h-4 text-slate-200" />
                  </div>
                )}
              </div>
            ))}

            {/* Wrap-around indicator */}
            {personnel.length > 1 && (
              <div className="flex items-center gap-2 justify-center pt-1 pb-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] text-slate-400 font-semibold whitespace-nowrap">
                  ↻ স্বয়ংক্রিয় পুনরাবৃত্তি
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
          </div>
        )}

        {/* ════════════════ LOGS TAB ════════════════ */}
        {tab === 'logs' && (
          <div className="px-4 pt-4 pb-28 space-y-4">

            {/* PDF export controls */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileDown className="w-4 h-4 text-[#1B3A6B]" />
                <p className="font-bold text-slate-800 text-[13px]">মাসিক ডিউটি স্টেটমেন্ট</p>
              </div>
              <div className="flex flex-col gap-2.5">
                <input
                  type="month"
                  value={pdfMonth}
                  onChange={e => setPdfMonth(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/20 focus:border-[#1B3A6B]"
                />
                {/* ── PDF download ── */}
                <button
                  onClick={handleExportPdf}
                  disabled={isExporting || isExportingJpg}
                  className="flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-5 rounded-lg shadow-md transition-all duration-200 active:scale-95"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>তৈরি হচ্ছে…</span>
                    </>
                  ) : (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className="w-5 h-5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                        />
                      </svg>
                      <span>ডাউনলোড পিডিএফ</span>
                    </>
                  )}
                </button>

                {/* ── Divider ── */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[11px] text-slate-400 font-medium">অথবা আজকের তালিকা</span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>

                {/* ── Today's list → JPG (WhatsApp) ── */}
                <button
                  onClick={handleDownloadTodayJPG}
                  disabled={isExportingJpg || isExporting}
                  className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-5 rounded-lg shadow-md transition-all duration-200 active:scale-95"
                >
                  {isExportingJpg ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>তৈরি হচ্ছে…</span>
                    </>
                  ) : (
                    <>
                      {/* WhatsApp logo mark */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-5 h-5"
                      >
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      <span>আজকের তালিকা (JPG)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {logsLoading && (
              <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
              </div>
            )}

            {!logsLoading && logs.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <FolderOpen className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-slate-500 font-semibold text-[14px]">এখনো কোনো ডিউটি লগ নেই</p>
                <p className="text-slate-400 text-[12px]">ডিউটি লাইন থেকে ডিপ্লয় করলে এখানে দেখাবে</p>
              </div>
            )}

            {/* Date-grouped logs */}
            {Array.from(logGroups.entries()).map(([dateKey, dayLogs]) => (
              <div key={dateKey} className="space-y-1.5">
                {/* Date header */}
                <div className="flex items-center gap-2 px-1">
                  <CalendarDays className="w-3.5 h-3.5 text-[#1B3A6B]" />
                  <p className="text-[12px] font-bold text-[#1B3A6B]">
                    {isToday(parseISO(dateKey)) ? 'আজকে — ' : ''}{formatBanglaDate(dateKey)}
                  </p>
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-[10px] text-slate-400 font-semibold">{dayLogs.length} জন</span>
                </div>

                {/* Log entries for this day */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  {dayLogs.map((log, i) => {
                    const colors = destColor(log.destination, destinations);
                    return (
                      <div
                        key={log.id}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3',
                          i < dayLogs.length - 1 && 'border-b border-slate-100',
                        )}
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <span className="text-slate-600 font-bold text-[13px]">
                            {log.staffName.charAt(0)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-[13px] truncate">{log.staffName}</p>
                          <p className="text-[11px] text-slate-400">{formatBanglaTime(log.deployedAt)}</p>
                        </div>
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-1 rounded-full border',
                          colors.bg, colors.text, colors.border,
                        )}>
                          {log.destination}
                        </span>
                        {/* Edit button */}
                        <button
                          onClick={() => { setEditLog(log); setCustomEditDest(''); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-[#1B3A6B] hover:bg-[#1B3A6B]/10 active:scale-95 transition-all shrink-0"
                          title="লোকেশন পরিবর্তন করুন"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ════════════════ DESTINATIONS TAB ════════════════ */}
        {tab === 'destinations' && (
          <div className="px-4 pt-4 pb-28 space-y-4">

            {/* Add destination card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-4 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-[#1B3A6B]" />
                <p className="font-bold text-slate-800 text-[13px]">নতুন গন্তব্য যোগ করুন</p>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="যেমন: রাজশাহী, রংপুর, হেড অফিস…"
                  value={newDestName}
                  onChange={e => setNewDestName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newDestName.trim() && !addDestMutation.isPending) {
                      addDestMutation.mutate(newDestName.trim());
                    }
                  }}
                  className="flex-1 rounded-xl border-slate-200 text-[14px] font-medium"
                />
                <Button
                  disabled={!newDestName.trim() || addDestMutation.isPending}
                  onClick={() => addDestMutation.mutate(newDestName.trim())}
                  className="bg-[#1B3A6B] hover:bg-[#243E72] font-bold px-4 shrink-0"
                >
                  {addDestMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : 'যোগ করুন'
                  }
                </Button>
              </div>
            </div>

            {/* Destination list */}
            {destinationsLoading && (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 text-slate-300 animate-spin" />
              </div>
            )}

            {!destinationsLoading && destinations.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <MapPin className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-slate-500 font-semibold text-[14px]">গন্তব্য তালিকা খালি</p>
                <p className="text-slate-400 text-[12px] max-w-[220px]">
                  উপরের ফিল্ডে গন্তব্যের নাম লিখে "যোগ করুন" বাটনে ট্যাপ করুন
                </p>
              </div>
            )}

            {destinations.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {destinations.map((dest, i) => {
                  const colors = PALETTE[i % PALETTE.length];
                  return (
                    <div
                      key={dest.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3.5',
                        i < destinations.length - 1 && 'border-b border-slate-100',
                      )}
                    >
                      <span className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                        colors.bg,
                      )}>
                        <MapPin className={cn('w-4 h-4', colors.text)} />
                      </span>
                      <p className="flex-1 font-semibold text-slate-800 text-[14px]">{dest.name}</p>
                      <button
                        onClick={() => setDeleteDestTarget(dest)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 active:scale-95 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {destinations.length > 0 && (
              <p className="text-center text-[11px] text-slate-400 font-medium px-2">
                মোট {destinations.length}টি গন্তব্য · ডিপ্লয় মোডালে এই তালিকা দেখাবে
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Fixed footer (Queue tab only) ── */}
      {tab === 'queue' && (
        <div
          className="fixed bottom-0 inset-x-0 px-4 pt-3 bg-white border-t border-slate-200 z-20"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 20px) + 1.5rem)' }}
        >
          <Button
            onClick={() => setShowAdd(true)}
            className="w-full bg-[#1B3A6B] hover:bg-[#243E72] font-bold"
          >
            <UserPlus2 className="w-4 h-4 mr-2" />
            নতুন স্টাফ যোগ করুন
          </Button>
        </div>
      )}

      {/* ════════════════════════════════════════════
          DEPLOY MODAL — dynamic destination picker
      ════════════════════════════════════════════ */}
      {deployTarget && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => { if (!deployMutation.isPending) setDeployTarget(null); }}
        >
          <div
            className="w-full bg-white rounded-t-3xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>

            {/* Staff info */}
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                ডিউটি দিচ্ছেন
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1B3A6B]/10 flex items-center justify-center">
                  <span className="text-[#1B3A6B] font-extrabold text-[15px]">
                    {deployTarget.name.charAt(0)}
                  </span>
                </div>
                <p className="font-extrabold text-slate-900 text-[18px]">{deployTarget.name}</p>
              </div>
            </div>

            {/* Dynamic destination grid */}
            <div className="px-5 pt-4 pb-5">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                গন্তব্য নির্বাচন করুন
              </p>

              {destinationsLoading && (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
                </div>
              )}

              {!destinationsLoading && destinations.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-center bg-amber-50 rounded-2xl border border-amber-100">
                  <MapPin className="w-6 h-6 text-amber-400" />
                  <p className="text-amber-700 font-bold text-[13px]">অনুগ্রহ করে প্রথমে গন্তব্য যোগ করুন</p>
                  <p className="text-amber-600 text-[11px] font-medium">
                    "গন্তব্য তালিকা" ট্যাবে গিয়ে গন্তব্য যোগ করুন
                  </p>
                  <button
                    onClick={() => { setDeployTarget(null); setTab('destinations'); }}
                    className="mt-1 text-[12px] font-bold text-[#1B3A6B] underline underline-offset-2"
                  >
                    গন্তব্য তালিকায় যান →
                  </button>
                </div>
              )}

              {destinations.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {destinations.map((dest, i) => {
                    const colors = PALETTE[i % PALETTE.length];
                    return (
                      <button
                        key={dest.id}
                        disabled={deployMutation.isPending}
                        onClick={() => deployMutation.mutate({ id: deployTarget.id, destination: dest.name })}
                        className={cn(
                          'flex items-center gap-2 px-3 py-3.5 rounded-2xl border-2 font-bold text-[13px] transition-all active:scale-[0.96] text-left',
                          colors.bg, colors.text, colors.border,
                          deployMutation.isPending && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{dest.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Safety padding */}
            <div className="pb-[calc(0.5rem+var(--safe-bottom,0px))]" />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          ADD STAFF MODAL
      ════════════════════════════════════════════ */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => !addMutation.isPending && setShowAdd(false)}
        >
          {/*
            The inner sheet shifts up by exactly keyboardHeight pixels when the
            virtual keyboard is open. transition-[margin] provides a smooth
            200 ms ease-out so it tracks the keyboard animation naturally.
            When the keyboard is absent (keyboardHeight === 0) the standard
            safe-area bottom padding takes over.
          */}
          <div
            className="w-full bg-white rounded-t-3xl shadow-2xl transition-[margin] duration-200 ease-out"
            style={{ marginBottom: keyboardHeight }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>
            <div className="px-5 pt-2 pb-6">
              <p className="font-extrabold text-slate-900 text-[18px] mb-4">নতুন স্টাফ যোগ করুন</p>
              <Input
                autoFocus
                placeholder="স্টাফের নাম লিখুন…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) {
                    addMutation.mutate(newName.trim());
                  }
                }}
                className="mb-3 rounded-xl border-slate-200 text-[15px] font-medium"
              />
              <Button
                className="w-full bg-[#1B3A6B] hover:bg-[#243E72] font-bold"
                disabled={!newName.trim() || addMutation.isPending}
                onClick={() => addMutation.mutate(newName.trim())}
              >
                {addMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'যোগ করুন'
                )}
              </Button>
            </div>
            {/* Safe-area padding — only meaningful when keyboard is hidden */}
            {keyboardHeight === 0 && (
              <div className="pb-[calc(env(safe-area-inset-bottom,0px)+8px)]" />
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          DELETE STAFF CONFIRM
      ════════════════════════════════════════════ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>স্টাফ ডিলিট করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              আপনি কি এই স্টাফের নাম সম্পূর্ণ ডিলিট করতে চান?{' '}
              <span className="font-semibold text-slate-800">{deleteTarget?.name}</span>-কে ডিউটি লাইন থেকে
              সরিয়ে দেওয়া হবে এবং পরবর্তী জন স্বয়ংক্রিয়ভাবে #১ হবেন। পুরনো লগ মুছবে না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-bold">বাতিল</AlertDialogCancel>
            <Button
              variant="destructive"
              className="font-bold"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'সরিয়ে দিন'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ════════════════════════════════════════════
          DELETE DESTINATION CONFIRM
      ════════════════════════════════════════════ */}
      <AlertDialog open={!!deleteDestTarget} onOpenChange={open => !open && setDeleteDestTarget(null)}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>গন্তব্য সরিয়ে দেবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-slate-800">"{deleteDestTarget?.name}"</span> গন্তব্যটি তালিকা থেকে
              সরানো হবে। পুরনো লগে এই নাম থেকে যাবে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-bold">বাতিল</AlertDialogCancel>
            <Button
              variant="destructive"
              className="font-bold"
              disabled={deleteDestMutation.isPending}
              onClick={() => deleteDestTarget && deleteDestMutation.mutate(deleteDestTarget.id)}
            >
              {deleteDestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'সরিয়ে দিন'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ════════════════════════════════════════════
          EDIT LOG MODAL — change a past deployment's location
      ════════════════════════════════════════════ */}
      {editLog && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => { if (!editLogMutation.isPending) { setEditLog(null); setCustomEditDest(''); } }}
        >
          <div
            className="w-full bg-white rounded-t-3xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>

            {/* Log info */}
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                লোকেশন পরিবর্তন করছেন
              </p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1B3A6B]/10 flex items-center justify-center shrink-0">
                    <span className="text-[#1B3A6B] font-extrabold text-[15px]">
                      {editLog.staffName.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="font-extrabold text-slate-900 text-[16px]">{editLog.staffName}</p>
                    <p className="text-[11px] text-slate-400">{formatBanglaDate(editLog.deployedAt)} — {formatBanglaTime(editLog.deployedAt)}</p>
                  </div>
                </div>
                {/* Current destination badge */}
                {(() => {
                  const c = destColor(editLog.destination, destinations);
                  return (
                    <span className={cn('text-[12px] font-bold px-3 py-1.5 rounded-full border shrink-0', c.bg, c.text, c.border)}>
                      {editLog.destination}
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* Destination list from saved destinations */}
            <div className="px-5 pt-4 pb-3">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                নতুন লোকেশন বেছে নিন
              </p>

              {destinations.length === 0 ? (
                <p className="text-slate-400 text-[12px] text-center py-3">
                  কোনো সংরক্ষিত গন্তব্য নেই — নিচে লিখে পরিবর্তন করুন
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 mb-0">
                  {destinations.map((dest, i) => {
                    const colors = PALETTE[i % PALETTE.length];
                    const isCurrent = dest.name === editLog.destination;
                    return (
                      <button
                        key={dest.id}
                        disabled={editLogMutation.isPending || isCurrent}
                        onClick={() => editLogMutation.mutate({ id: editLog.id, destination: dest.name })}
                        className={cn(
                          'flex items-center gap-2 px-3 py-3 rounded-2xl border-2 font-bold text-[13px] transition-all active:scale-[0.96] text-left relative',
                          colors.bg, colors.text, colors.border,
                          isCurrent && 'opacity-40 cursor-not-allowed',
                          editLogMutation.isPending && !isCurrent && 'opacity-60 cursor-not-allowed',
                        )}
                      >
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{dest.name}</span>
                        {isCurrent && (
                          <span className="absolute top-0.5 right-1.5 text-[9px] font-bold opacity-60">বর্তমান</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Free-text override input (for corrections not in the list) */}
            <div className="px-5 pb-4 pt-2 border-t border-slate-100">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                অথবা সরাসরি লিখুন
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="যেকোনো শহর, শাখা বা ঠিকানা…"
                  value={customEditDest}
                  onChange={e => setCustomEditDest(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customEditDest.trim() && !editLogMutation.isPending) {
                      editLogMutation.mutate({ id: editLog.id, destination: customEditDest.trim() });
                    }
                  }}
                  className="flex-1 rounded-xl border-slate-200 text-[14px] font-medium"
                />
                <Button
                  disabled={!customEditDest.trim() || editLogMutation.isPending}
                  onClick={() => editLogMutation.mutate({ id: editLog.id, destination: customEditDest.trim() })}
                  className="bg-[#1B3A6B] hover:bg-[#243E72] font-bold px-4 shrink-0"
                >
                  {editLogMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <SendHorizontal className="w-4 h-4" />
                  }
                </Button>
              </div>
            </div>

            {/* Safety padding */}
            <div className="pb-[calc(0.5rem+var(--safe-bottom,0px))]" />
          </div>
        </div>
      )}

      {/* Settings drawer (accessible from header) */}
      <SettingsDrawer open={showSettings} onOpenChange={setShowSettings} />

      {/* PDF container is created dynamically in handleExportPdf via
          document.createElement and appended directly to document.body so it
          is completely isolated from the app's CSS stacking context. */}
    </div>
  );
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

/** Convert ASCII digits to Bangla numerals (e.g. 42 → ৪২). */
function toBangla(n: number): string {
  const map: Record<string, string> = {
    '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
    '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
  };
  return String(n).replace(/[0-9]/g, d => map[d]);
}

/**
 * Groups a day's logs into (destination → staffNames[]) pairs, preserving the
 * order in which each destination first appeared that day.
 */
function buildDateDestGroups(groups: Map<string, DeploymentLog[]>) {
  return Array.from(groups.entries()).map(([, dayLogs]) => {
    const destMap = new Map<string, string[]>();
    for (const log of dayLogs) {
      if (!destMap.has(log.destination)) destMap.set(log.destination, []);
      destMap.get(log.destination)!.push(log.staffName);
    }
    return {
      dateLabel: format(parseISO(dayLogs[0].deployedAt), 'd MMMM, yyyy', { locale: bn }),
      destinations: Array.from(destMap.entries()).map(([name, staffNames]) => ({
        name,
        staffNames,
        count: staffNames.length,
      })),
    };
  });
}

// ── PDF HTML builder ──────────────────────────────────────────────────────────

function buildPdfHtml({
  monthLabel,
  monthLogs,
  tally,
  groups,
  queueRemaining,
}: {
  monthLabel: string;
  monthLogs: DeploymentLog[];
  tally: Record<string, number>;
  groups: Map<string, DeploymentLog[]>;
  queueRemaining: number;
}) {
  const NAV   = '#1B3A6B';   // brand navy
  const OR    = '#F5A623';   // accent orange
  const DARK  = '#0f1d35';   // footer dark
  const CNT_E = '#EFF6FF';   // count col, even row  (light blue)
  const CNT_O = '#DBEAFE';   // count col, odd row   (slightly deeper blue)
  const ROW_E = '#f8fafc';   // zebra even
  const ROW_O = '#ffffff';   // zebra odd

  const tallyEntries  = Object.entries(tally);
  const uniqueDests   = tallyEntries.length;
  const dateGroups    = buildDateDestGroups(groups);

  // ── Main ledger rows (grouped by date × destination) ──────────────────────
  //
  // Layout: 4 columns — তারিখ | গন্তব্য | স্টাফের নাম | কতজন গেল
  //
  // For each date group we emit N rows (one per destination).
  // • The first row of each group carries the date badge + a thick 2 px top
  //   separator to visually break date blocks.
  // • Subsequent rows inside the same group show an empty date cell with a
  //   3 px left accent bar so the reader can see they belong to the same day,
  //   without needing fragile rowspan.

  let rowIdx = 0; // global counter drives zebra striping across all rows

  const ledgerRows = dateGroups.flatMap(({ dateLabel, destinations }) =>
    destinations.map((dest, dIdx) => {
      const isFirst = dIdx === 0;
      const isEven  = rowIdx % 2 === 0;
      rowIdx++;

      const rowBg    = isEven ? ROW_E : ROW_O;
      const cntBg    = isEven ? CNT_E : CNT_O;
      const topBdr   = isFirst
        ? `border-top:2px solid #cbd5e1`   // thick line = new date group
        : `border-top:1px solid #f1f5f9`;  // thin line = same date, next dest

      // Date cell: badge on first row, accent-bar placeholder on subsequent rows
      const dateCell = isFirst
        ? `<td style="padding:10px 12px 10px 14px;vertical-align:middle;
              ${topBdr};border-right:1px solid #e2e8f0;width:22%">
             <div style="display:inline-block;background:#EFF6FF;border:1px solid #BFDBFE;
                         border-radius:6px;padding:3px 9px">
               <span style="font-size:11px;font-weight:800;color:${NAV};
                            white-space:nowrap">${dateLabel}</span>
             </div>
           </td>`
        : `<td style="padding:0;vertical-align:top;${topBdr};
              border-right:1px solid #e2e8f0;border-left:3px solid ${NAV};
              width:22%;background:${rowBg}"></td>`;

      // Destination pill
      const destCell = `
        <td style="padding:10px 12px;vertical-align:middle;${topBdr};
            border-right:1px solid #e2e8f0;width:18%;background:${rowBg}">
          <span style="display:inline-block;background:${NAV};color:#fff;
                       padding:3px 11px;border-radius:20px;
                       font-size:11px;font-weight:700;white-space:nowrap">
            ${dest.name}
          </span>
        </td>`;

      // Staff names (comma-separated, wraps naturally)
      const namesCell = `
        <td style="padding:10px 14px;vertical-align:middle;${topBdr};
            border-right:1px solid #e2e8f0;font-size:12px;color:#334155;
            line-height:1.6;background:${rowBg}">
          ${dest.staffNames.join(', ')}
        </td>`;

      // Count column — always highlighted regardless of zebra row
      const countCell = `
        <td style="padding:10px 8px;vertical-align:middle;text-align:center;
            ${topBdr};background:${cntBg};width:13%">
          <span style="font-size:20px;font-weight:900;color:${NAV};
                       display:block;line-height:1.1">
            ${toBangla(dest.count)}
          </span>
          <span style="font-size:10px;font-weight:700;color:#4B70B0">জন</span>
        </td>`;

      return `<tr style="background:${rowBg}">
        ${dateCell}${destCell}${namesCell}${countCell}
      </tr>`;
    }),
  ).join('');

  // ── Destination summary rows ───────────────────────────────────────────────
  const summaryRows = tallyEntries.map(([dest, count], i) => {
    const bg = i % 2 === 0 ? ROW_E : ROW_O;
    return `
      <tr style="background:${bg}">
        <td style="padding:9px 14px;font-size:12px;font-weight:700;color:#1e293b;
            border-top:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
          ${dest}
        </td>
        <td style="padding:9px 14px;text-align:center;${i % 2 === 0 ? `background:${CNT_E}` : `background:${CNT_O}`};
            border-top:1px solid #e2e8f0">
          <span style="font-size:18px;font-weight:900;color:${NAV}">${toBangla(count)}</span>
          <span style="font-size:11px;font-weight:600;color:#4B70B0"> জন</span>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="font-family:Inter,'Noto Sans Bengali',sans-serif;color:#0f172a;padding:0;background:#fff">

      <!-- ═══ Brand header ═══ -->
      <div style="background:${NAV};padding:20px 24px;display:flex;align-items:center;
                  justify-content:space-between;border-radius:8px 8px 0 0">
        <div>
          <p style="color:#fff;font-size:21px;font-weight:900;margin:0;letter-spacing:-0.5px">
            Banglakhata
          </p>
          <p style="color:rgba(255,255,255,0.70);font-size:12px;margin:5px 0 0;font-weight:600">
            মাসিক ডিউটি স্টেটমেন্ট
          </p>
        </div>
        <div style="background:${OR};padding:6px 16px;border-radius:20px">
          <p style="color:${NAV};font-size:12px;font-weight:900;margin:0">${monthLabel}</p>
        </div>
      </div>

      <!-- Orange accent bar -->
      <div style="height:4px;background:${OR}"></div>

      <!-- ═══ Summary strip ═══ -->
      <div style="display:flex;gap:0;border:1px solid #e2e8f0;border-top:none">
        <div style="flex:1;padding:14px 8px;text-align:center;border-right:1px solid #e2e8f0">
          <p style="font-size:26px;font-weight:900;color:${NAV};margin:0">${toBangla(monthLogs.length)}</p>
          <p style="font-size:10px;color:#64748b;margin:4px 0 0;font-weight:600">মোট ডিউটি</p>
        </div>
        <div style="flex:1;padding:14px 8px;text-align:center;border-right:1px solid #e2e8f0">
          <p style="font-size:26px;font-weight:900;color:#059669;margin:0">${toBangla(groups.size)}</p>
          <p style="font-size:10px;color:#64748b;margin:4px 0 0;font-weight:600">কার্যদিন</p>
        </div>
        <div style="flex:1;padding:14px 8px;text-align:center;border-right:1px solid #e2e8f0">
          <p style="font-size:26px;font-weight:900;color:#f59e0b;margin:0">${toBangla(uniqueDests)}</p>
          <p style="font-size:10px;color:#64748b;margin:4px 0 0;font-weight:600">গন্তব্য</p>
        </div>
        <div style="flex:1;padding:14px 8px;text-align:center">
          <p style="font-size:26px;font-weight:900;color:#7c3aed;margin:0">${toBangla(queueRemaining)}</p>
          <p style="font-size:10px;color:#64748b;margin:4px 0 0;font-weight:600">লাইনে আছেন</p>
        </div>
      </div>

      <!-- ═══ Main ledger table ═══ -->
      <div style="margin:16px 0 0">
        <div style="background:${NAV};padding:9px 16px;border-radius:6px 6px 0 0;
                    display:flex;align-items:center;justify-content:space-between">
          <p style="color:#fff;font-size:12px;font-weight:800;letter-spacing:0.04em;margin:0">
            তারিখ ও গন্তব্য অনুযায়ী ডিউটি বিবরণ
          </p>
          <span style="color:rgba(255,255,255,0.55);font-size:10px;font-weight:600">
            ${toBangla(monthLogs.length)} টি এন্ট্রি
          </span>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none">
          <thead>
            <tr style="background:#1e3a8a">
              <th style="padding:9px 14px;font-size:11px;color:#fff;font-weight:700;
                         text-align:left;width:22%;border-right:1px solid rgba(255,255,255,0.15)">
                তারিখ
              </th>
              <th style="padding:9px 14px;font-size:11px;color:#fff;font-weight:700;
                         text-align:left;width:18%;border-right:1px solid rgba(255,255,255,0.15)">
                গন্তব্য
              </th>
              <th style="padding:9px 14px;font-size:11px;color:#fff;font-weight:700;
                         text-align:left;border-right:1px solid rgba(255,255,255,0.15)">
                স্টাফের নাম
              </th>
              <th style="padding:9px 8px;font-size:11px;color:${OR};font-weight:800;
                         text-align:center;width:13%;background:rgba(0,0,0,0.20)">
                কতজন গেল
              </th>
            </tr>
          </thead>
          <tbody>
            ${ledgerRows || `
              <tr>
                <td colspan="4" style="padding:28px;text-align:center;color:#94a3b8;font-size:13px">
                  এই মাসে কোনো ডিউটি নেই
                </td>
              </tr>`}
          </tbody>
        </table>
      </div>

      <!-- ═══ Destination summary table ═══ -->
      ${summaryRows ? `
      <div style="margin:16px 0 0">
        <div style="background:#334155;padding:9px 16px;border-radius:6px 6px 0 0">
          <p style="color:#fff;font-size:11px;font-weight:700;letter-spacing:0.06em;margin:0">
            গন্তব্য অনুযায়ী মোট সারসংক্ষেপ
          </p>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="padding:8px 14px;font-size:11px;color:#64748b;font-weight:700;
                         text-align:left;border-right:1px solid #e2e8f0">
                গন্তব্য
              </th>
              <th style="padding:8px 14px;font-size:11px;color:#64748b;font-weight:700;
                         text-align:center">
                মোট স্টাফ পাঠানো হয়েছে
              </th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
      </div>` : ''}

      <!-- ═══ Footer ═══ -->
      <div style="margin-top:20px;background:${DARK};padding:12px 20px;
                  border-radius:0 0 8px 8px;display:flex;align-items:center;gap:10px">
        <div style="width:22px;height:22px;background:${OR};border-radius:50%;flex-shrink:0;
                    display:flex;align-items:center;justify-content:center">
          <span style="color:${DARK};font-size:12px;font-weight:900">✓</span>
        </div>
        <p style="color:rgba(255,255,255,0.75);font-size:10px;font-weight:600;margin:0">
          ১০০% নিরাপদ ও সুরক্ষিত Banglakhata — তৈরি হয়েছে:
          ${format(new Date(), 'd MMM yyyy, hh:mm a', { locale: bn })}
        </p>
      </div>

    </div>
  `;
}
