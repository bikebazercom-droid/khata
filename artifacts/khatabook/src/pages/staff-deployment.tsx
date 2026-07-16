/**
 * Staff Duty Deployment & Rotation Module
 *
 * Completely isolated from customer ledger / financial accounting.
 * Uses raw fetch + react-query directly — no generated API client coupling.
 */

import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import html2pdf from 'html2pdf.js';
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
  const [isExporting, setIsExporting] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);

  // ── queries ────────────────────────────────────────────────────────────────

  const { data: personnel = [], isLoading: personnelLoading } = useQuery<StaffMember[]>({
    queryKey: ['staff-personnel'],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/staff/personnel`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch personnel');
      return r.json();
    },
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<DeploymentLog[]>({
    queryKey: ['staff-logs'],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/staff/logs`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch logs');
      return r.json();
    },
  });

  const { data: destinations = [], isLoading: destinationsLoading } = useQuery<StaffDestination[]>({
    queryKey: ['staff-destinations'],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/staff/destinations`, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch destinations');
      return r.json();
    },
  });

  // ── mutations ──────────────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch(`${BASE}/api/staff/personnel`, {
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
      const r = await fetch(`${BASE}/api/staff/personnel/${id}/deploy`, {
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
      const r = await fetch(`${BASE}/api/staff/personnel/${id}`, {
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
      const r = await fetch(`${BASE}/api/staff/logs/${id}`, {
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
      const r = await fetch(`${BASE}/api/staff/destinations`, {
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
      const r = await fetch(`${BASE}/api/staff/destinations/${id}`, {
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

  // ── PDF export ─────────────────────────────────────────────────────────────

  async function handleExportPdf() {
    setIsExporting(true);
    try {
      const [year, mon] = pdfMonth.split('-').map(Number);
      const monthLabel  = format(new Date(year, mon - 1, 1), 'MMMM yyyy', { locale: bn });

      // ── Step 1: fetch month logs ─────────────────────────────────────────
      const r = await fetch(`${BASE}/api/staff/logs?month=${pdfMonth}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      const monthLogs: DeploymentLog[] = await r.json();

      const tally  = destinationTally(monthLogs);
      const groups = groupLogsByDate(monthLogs);

      // ── Step 2: locate the print container ──────────────────────────────
      //
      // We prefer the React ref (available as soon as the component mounts)
      // but fall back to getElementById as a belt-and-suspenders guard for
      // the rare case where the ref hasn't been assigned yet (e.g. during
      // a very fast re-render cycle on low-end Android devices).
      const element: HTMLElement | null =
        pdfRef.current ?? document.getElementById('pdf-print-template');

      if (!element) throw new Error('PDF container not found in DOM');

      // ── Step 3: populate the container ──────────────────────────────────
      //
      // The container is position:fixed; left:-9999px — fully laid out by
      // the browser but scrolled far off the visible viewport. html2canvas
      // captures the element's painted pixels, not the viewport, so this
      // placement is safe on all browsers including mobile Safari.
      const html = buildPdfHtml({ monthLabel, monthLogs, tally, groups, queueRemaining });
      element.innerHTML = html;

      // ── Step 4: explicit content guard ──────────────────────────────────
      //
      // If the container has no children after innerHTML injection (e.g.
      // DOMParser rejected the markup), abort early with a clear error
      // rather than silently generating a blank PDF.
      if (element.children.length === 0) {
        throw new Error('PDF template rendered no DOM nodes — aborting');
      }

      // ── Step 5: font readiness ──────────────────────────────────────────
      //
      // document.fonts.ready resolves once every @font-face rule referenced
      // in the document has been decoded (including Noto Sans Bengali loaded
      // from Google Fonts in index.html). Skipping this wait causes Bengali
      // text to render as square boxes in the captured canvas.
      await document.fonts.ready;

      // ── Step 6: double requestAnimationFrame ────────────────────────────
      //
      // A single rAF only guarantees that the browser has *scheduled* the
      // next paint. For newly-injected innerHTML, the browser needs TWO
      // frames:
      //   Frame 1 → style recalculation + layout (reflow) for new nodes
      //   Frame 2 → paint pass completes → pixels committed to the layer
      // html2canvas reads from the committed layer. Capturing after only
      // one frame on mobile Chrome/WebKit frequently produces a blank canvas
      // because the paint pass hasn't finished.
      await new Promise<void>(r1 => requestAnimationFrame(() =>
        requestAnimationFrame(() => r1()),
      ));

      // ── Step 7: generate PDF ─────────────────────────────────────────────
      //
      // Configuration rationale:
      //   windowWidth:794   — tells html2canvas to emulate an A4-wide desktop
      //                        viewport (794 px ≈ A4 @ 96 dpi). Without this,
      //                        mobile Chrome uses the physical viewport (~390 px)
      //                        and clips half the page content.
      //   scale:2           — 2× renders at 192 dpi for crisp text in PDF.
      //   useCORS:true      — required for Google Fonts cross-origin resources.
      //   allowTaint:true   — prevents canvas abort on tainted cross-origin
      //                        resources (fonts, background images).
      //   letterRendering:  — forces sub-pixel letter spacing on WebKit,
      //                        matching what the CSS engine calculated during
      //                        layout. Without it, rendered text can overlap
      //                        or have gaps that differ from the live DOM.
      await html2pdf()
        .set({
          margin:      [10, 10, 10, 10],
          filename:    `ডিউটি-স্টেটমেন্ট-${pdfMonth}.pdf`,
          image:       { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale:           2,
            useCORS:         true,
            allowTaint:      true,
            letterRendering: true,
            windowWidth:     794,
            logging:         false,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(element)
        .save();

      element.innerHTML = '';
      toast.success('PDF ডাউনলোড হয়েছে');
    } catch (err) {
      console.error('[PDF export]', err);
      toast.error('PDF তৈরি করতে ব্যর্থ হয়েছে');
    } finally {
      setIsExporting(false);
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
              <div className="flex items-center gap-2">
                <input
                  type="month"
                  value={pdfMonth}
                  onChange={e => setPdfMonth(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-[13px] text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#1B3A6B]/20 focus:border-[#1B3A6B]"
                />
                <Button
                  onClick={handleExportPdf}
                  disabled={isExporting}
                  className="bg-[#1B3A6B] hover:bg-[#243E72] font-bold text-[12px] px-4"
                >
                  {isExporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <FileDown className="w-3.5 h-3.5 mr-1.5" />
                      PDF
                    </>
                  )}
                </Button>
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

      {/*
        PDF print template — off-screen but FULLY RENDERED.

        Rules that make html2canvas work on mobile:
        • NOT display:none — html2canvas returns an empty canvas for hidden
          elements; position:fixed; left:-9999px keeps it invisible while
          remaining in the layout tree.
        • Explicit width:794px — matches A4 at 96 dpi; prevents mobile
          viewports (≈390 px) from clipping half the page.
        • zIndex must be POSITIVE — zIndex:-1 pushes the element behind the
          stacking context root; some mobile browsers exclude back-painted
          layers from the compositor snapshot that html2canvas reads, causing
          a blank capture. Using a high positive value keeps it in-tree but
          visually off-screen.
        • id="pdf-print-template" — used by handleExportPdf as a belt-and-
          suspenders getElementById fallback alongside the React ref.
      */}
      <div
        id="pdf-print-template"
        ref={pdfRef}
        aria-hidden
        style={{
          position:        'fixed',
          left:            '-9999px',
          top:             '0',
          width:           '794px',
          backgroundColor: '#fff',
          pointerEvents:   'none',
          zIndex:          9999,
        }}
      />
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
            ডিজিটাল খাতা
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
          ১০০% নিরাপদ ও সুরক্ষিত ডিজিটাল খাতা — তৈরি হয়েছে:
          ${format(new Date(), 'd MMM yyyy, hh:mm a', { locale: bn })}
        </p>
      </div>

    </div>
  `;
}
