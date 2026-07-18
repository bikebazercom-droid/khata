import { useState, useCallback } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Link, useLocation } from 'wouter';
import {
  useListParties,
  useGetBusinessSettings,
  PartyRole,
  DueFilter,
} from '@workspace/api-client-react';
import { useMemo } from 'react';
import { Search, Plus, Settings, User, ChevronRight, UserPlus2, SlidersHorizontal, FileText, Users, Pencil, FolderOpen, X, MessageSquare, MessageCircle } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { AddPartyModal } from '@/components/modals/add-party-modal';
import { SettingsDrawer } from '@/components/modals/settings-drawer';
import { AddStaffDialog } from '@/components/modals/add-staff-dialog';
import { RenameStoreDialog } from '@/components/modals/rename-store-dialog';
import { formatDistanceToNow } from 'date-fns';
import { bn } from 'date-fns/locale';
import { toast } from 'sonner';

export function HomeView() {
  const [role, setRole] = useState<PartyRole>(PartyRole.CUSTOMER);
  const [search, setSearch] = useState('');
  const [location, navigate] = useLocation();

  // ── Advanced filter / sort sheet ────────────────────────────────────────
  // "pending" = draft state while the sheet is open
  // "applied" = committed state that drives the query + client sort
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [pendingFilter, setPendingFilter] = useState('all');
  const [pendingSort,   setPendingSort]   = useState('recent');
  const [appliedFilter, setAppliedFilter] = useState('all');
  const [appliedSort,   setAppliedSort]   = useState('recent');

  const isFiltered = appliedFilter !== 'all' || appliedSort !== 'recent';

  const openFilterSheet = () => {
    setPendingFilter(appliedFilter);
    setPendingSort(appliedSort);
    setIsFilterSheetOpen(true);
  };

  const applyFilter = () => {
    setAppliedFilter(pendingFilter);
    setAppliedSort(pendingSort);
    setIsFilterSheetOpen(false);
  };

  // Map the selected filter pill → DueFilter for the API call
  const apiDueFilter: DueFilter = (() => {
    switch (appliedFilter) {
      case 'today':     return DueFilter.DUE_TODAY;
      case 'upcoming':  return DueFilter.UPCOMING;
      case 'permanent':
      case 'no_date':   return DueFilter.NO_DUE_DATE;
      default:          return DueFilter.ALL;
    }
  })();
  const [isAddPartyOpen, setIsAddPartyOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [isRenameStoreOpen, setIsRenameStoreOpen] = useState(false);

  const [requestModalParty, setRequestModalParty] = useState<{ id: string; name: string; phone?: string | null; currentBalance: number; balanceType: string } | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const { data: settings } = useGetBusinessSettings();
  // Role-only parties (no search/dueFilter) — used purely for the summary card so
  // the totals reflect the active tab, not the current search query.
  const { data: summaryParties = [] } = useListParties({ role });
  const { data: rawParties = [] } = useListParties({ role, search, dueFilter: apiDueFilter });

  // Client-side balance-type filter + sort applied on top of the server response.
  const parties = useMemo(() => {
    let result = rawParties;
    // Balance-type filter (will_get / will_give) has no server-side equivalent
    if (appliedFilter === 'will_get') result = result.filter(p => p.balanceType === 'YOU_WILL_GET');
    if (appliedFilter === 'will_give') result = result.filter(p => p.balanceType === 'YOU_WILL_GIVE');
    // Sort
    switch (appliedSort) {
      case 'highest': return [...result].sort((a, b) => b.currentBalance - a.currentBalance);
      case 'lowest':  return [...result].sort((a, b) => a.currentBalance - b.currentBalance);
      case 'name':    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'bn'));
      case 'oldest':  return [...result].sort((a, b) => {
        const aT = a.lastTransactionAt ? new Date(a.lastTransactionAt).getTime() : 0;
        const bT = b.lastTransactionAt ? new Date(b.lastTransactionAt).getTime() : 0;
        return aT - bT;
      });
      default: return result; // 'recent' — API already returns newest-first
    }
  }, [rawParties, appliedFilter, appliedSort]);

  // Compute summary totals from the role-filtered list.
  const roleSummary = useMemo(() => {
    let youWillGet = 0;
    let youWillGive = 0;
    for (const p of summaryParties) {
      if (p.balanceType === 'YOU_WILL_GET') youWillGet += p.currentBalance;
      else youWillGive += p.currentBalance;
    }
    return { youWillGet, youWillGive };
  }, [summaryParties]);

  const handleShareRequest = useCallback((platform: 'sms' | 'whatsapp') => {
    if (!requestModalParty) return;
    const storeName = settings?.storeName || 'ডিজিটাল খাতা';
    const amount = formatCurrency(requestModalParty.currentBalance);
    const message =
      `প্রিয় ${requestModalParty.name}, আপনার বকেয়া ${amount} পরিশোধের জন্য বিনীত অনুরোধ করা হচ্ছে। — ${storeName}`;
    if (platform === 'whatsapp') {
      let phone = (requestModalParty.phone ?? '').replace(/\D/g, '');
      if (phone.startsWith('0')) phone = '880' + phone.slice(1);
      const url = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank', 'noreferrer');
    } else {
      const phone = requestModalParty.phone ?? '';
      window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
    }
  }, [requestModalParty, settings?.storeName]);

  const exportFilteredReportToPDF = useCallback(async () => {
    setIsExportingPdf(true);

    const storeName  = settings?.storeName || 'ডিজিটাল খাতা';
    const roleLabel  = role === PartyRole.CUSTOMER ? 'গ্রাহক' : 'সরবরাহকারী';
    const nameColHeader = role === PartyRole.CUSTOMER ? 'নাম' : 'সরবরাহকারীর নাম';
    const dateStr    = new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr    = new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });

    let filteredGet  = 0;
    let filteredGive = 0;
    for (const p of parties) {
      if (p.balanceType === 'YOU_WILL_GET') filteredGet  += p.currentBalance;
      else                                  filteredGive += p.currentBalance;
    }
    const netBalance = filteredGet - filteredGive;

    const filterDisplayLabel: Record<string, string> = {
      all:       'সব',
      will_get:  'আপনি পাবেন',
      will_give: 'আপনি দেবেন',
      today:     'আজকের বাকি',
      upcoming:  'আপকামিং',
      permanent: 'স্থায়ী',
      no_date:   'তারিখ নেই',
    };
    const countTag = filterDisplayLabel[appliedFilter] ?? 'সব';

    // ── Build an off-screen DOM node — the browser shapes Bengali perfectly ──
    const container = document.createElement('div');
    container.style.cssText = [
      'position:absolute',
      'left:-9999px',
      'top:0',
      'width:794px',
      'background:#fff',
      "font-family:'Noto Sans Bengali','Hind Siliguri',sans-serif",
      'padding-bottom:40px',
    ].join(';');

    const rowsHtml = parties.map(p => {
      const dateCell = p.lastTransactionAt
        ? new Date(p.lastTransactionAt).toLocaleDateString('en-GB')
        : '—';
      const getCell = p.balanceType === 'YOU_WILL_GET'
        ? `<td style="padding:10px;border:1px solid #E2E8F0;text-align:right;background:#FEF2F2;color:#DC2626;font-weight:bold;">৳${p.currentBalance.toFixed(2)}</td>`
        : `<td style="padding:10px;border:1px solid #E2E8F0;text-align:right;"></td>`;
      const giveCell = p.balanceType === 'YOU_WILL_GIVE'
        ? `<td style="padding:10px;border:1px solid #E2E8F0;text-align:right;background:#F0FDF4;color:#16A34A;font-weight:bold;">৳${p.currentBalance.toFixed(2)}</td>`
        : `<td style="padding:10px;border:1px solid #E2E8F0;text-align:right;"></td>`;
      return `
        <tr style="border-bottom:1px solid #E2E8F0;">
          <td style="padding:10px;border:1px solid #E2E8F0;font-weight:500;">${p.name  || '—'}</td>
          <td style="padding:10px;border:1px solid #E2E8F0;color:#64748B;">${p.phone || '—'}</td>
          ${getCell}
          ${giveCell}
          <td style="padding:10px;border:1px solid #E2E8F0;text-align:center;color:#64748B;">${dateCell}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <!-- Blue banner -->
      <div style="background:#004BA0;display:flex;justify-content:space-between;align-items:center;padding:12px 24px;color:#fff;font-size:14px;font-weight:bold;">
        <div>${storeName}</div>
        <div>Khatabook</div>
      </div>

      <!-- Title -->
      <div style="text-align:center;margin-top:24px;">
        <div style="margin:0;font-size:20px;font-weight:bold;color:#1E293B;">${roleLabel} তালিকার রিপোর্ট</div>
        <div style="margin-top:6px;font-size:13px;color:#64748B;">(আজ পর্যন্ত - ${dateStr})</div>
      </div>

      <!-- 3-column stats card -->
      <div style="margin:20px 24px 0;border:1px solid #E2E8F0;border-radius:4px;display:table;width:calc(100% - 48px);border-collapse:collapse;">
        <div style="display:table-row;">
          <div style="display:table-cell;width:33.33%;text-align:center;padding:12px;border-right:1px solid #E2E8F0;">
            <div style="font-size:12px;color:#94A3B8;margin-bottom:5px;">আপনি পাবেন</div>
            <div style="font-size:15px;font-weight:bold;color:#0F172A;">৳${filteredGet.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}</div>
          </div>
          <div style="display:table-cell;width:33.33%;text-align:center;padding:12px;border-right:1px solid #E2E8F0;">
            <div style="font-size:12px;color:#94A3B8;margin-bottom:5px;">আপনি দেবেন</div>
            <div style="font-size:15px;font-weight:bold;color:#0F172A;">৳${filteredGive.toLocaleString('bn-BD', { minimumFractionDigits: 2 })}</div>
          </div>
          <div style="display:table-cell;width:33.33%;text-align:center;padding:12px;">
            <div style="font-size:12px;color:#94A3B8;margin-bottom:5px;">মোট ব্যালেন্স</div>
            <div style="font-size:15px;font-weight:bold;color:${netBalance >= 0 ? '#16A34A' : '#DC2626'};">
              ৳${Math.abs(netBalance).toLocaleString('bn-BD', { minimumFractionDigits: 2 })} ${netBalance >= 0 ? 'Cr' : 'Dr'}
            </div>
          </div>
        </div>
      </div>

      <!-- Count label -->
      <div style="margin:16px 24px 8px;font-size:13px;color:#334155;font-weight:bold;">
        ${roleLabel} সংখ্যা: ${parties.length} (${countTag})
      </div>

      <!-- Data table -->
      <table style="width:calc(100% - 48px);margin:0 24px;border-collapse:collapse;font-size:12px;text-align:left;color:#334155;">
        <thead>
          <tr style="background:#F8FAFC;">
            <th style="padding:10px;border:1px solid #E2E8F0;width:22%;">${nameColHeader}</th>
            <th style="padding:10px;border:1px solid #E2E8F0;width:22%;">ডিটেলস</th>
            <th style="padding:10px;border:1px solid #E2E8F0;width:18%;text-align:right;">আপনি পাবেন</th>
            <th style="padding:10px;border:1px solid #E2E8F0;width:18%;text-align:right;">আপনি দেবেন</th>
            <th style="padding:10px;border:1px solid #E2E8F0;width:20%;text-align:center;">সংগ্রহের দিন</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr style="background:#F1F5F9;font-weight:bold;border-top:2px solid #CBD5E1;">
            <td style="padding:12px 10px;border:1px solid #E2E8F0;">সর্বমোট</td>
            <td style="padding:12px 10px;border:1px solid #E2E8F0;"></td>
            <td style="padding:12px 10px;border:1px solid #E2E8F0;text-align:right;color:#DC2626;">৳${filteredGet.toFixed(2)}</td>
            <td style="padding:12px 10px;border:1px solid #E2E8F0;text-align:right;color:#16A34A;">৳${filteredGive.toFixed(2)}</td>
            <td style="padding:12px 10px;border:1px solid #E2E8F0;"></td>
          </tr>
        </tbody>
      </table>

      <!-- Timestamp footer -->
      <div style="margin:16px 24px 0;font-size:11px;color:#94A3B8;">
        রিপোর্ট তৈরি হয়েছে : ${timeStr} | ${dateStr}
      </div>
    `;

    document.body.appendChild(container);

    try {
      // html2canvas — browser renders & shapes Bengali natively
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      document.body.removeChild(container);

      const imgData   = canvas.toDataURL('image/jpeg', 0.95);
      const pdf       = new jsPDF('p', 'mm', 'a4');
      const pdfW      = 210;           // A4 width mm
      const pdfH      = 297;           // A4 height mm
      const imgH      = (canvas.height * pdfW) / canvas.width;

      // Slice tall canvases across multiple pages
      let yOffset = 0;
      let firstPage = true;
      while (yOffset < imgH) {
        if (!firstPage) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, imgH);
        yOffset   += pdfH;
        firstPage  = false;
      }

      const roleTag  = role === PartyRole.CUSTOMER ? 'Customer' : 'Supplier';
      const filename = `HazariKhata_${roleTag}_${new Date().toISOString().split('T')[0]}.pdf`;
      const pdfBlob  = pdf.output('blob');
      const pdfFile  = new File([pdfBlob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({
            files: [pdfFile],
            title: `${roleLabel} তালিকার রিপোর্ট`,
            text: `${storeName} এর ফিল্টার করা ${roleLabel} তালিকার রিপোর্ট`,
          });
        } catch (shareErr) {
          if ((shareErr as DOMException).name !== 'AbortError') pdf.save(filename);
        }
      } else {
        pdf.save(filename);
      }
    } catch (err) {
      if (document.body.contains(container)) document.body.removeChild(container);
      console.error('PDF export failed:', err);
      toast.error('PDF তৈরি করতে সমস্যা হয়েছে।');
    } finally {
      setIsExportingPdf(false);
    }
  }, [parties, role, appliedFilter, settings?.storeName]);

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* Fixed deep-blue top header */}
      <div className="shrink-0 bg-[#1B3A6B] pb-9 z-10">
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(1rem+var(--safe-top))]">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/logo-icon.svg`}
              alt="ডিজিটাল খাতা"
              className="w-9 h-9 shrink-0"
            />
            <h1 className="font-extrabold tracking-tight text-[15px] text-white truncate max-w-[120px]">
              {settings?.storeName || 'ডিজিটাল খাতা'}
            </h1>
            <button
              onClick={() => setIsRenameStoreOpen(true)}
              aria-label="দোকানের নাম সম্পাদনা করুন"
              className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-white/60 active:bg-white/15 active:text-white transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate('/staff-deployment')}
              className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-bold px-3 py-2 rounded-xl active:scale-95 transition-all"
            >
              <UserPlus2 className="w-3.5 h-3.5" />
              স্টাফ যোগ করুন
            </button>
            <button
              onClick={() => navigate('/staff-deployment')}
              aria-label="ডিউটি ফোল্ডার"
              className="w-9 h-9 rounded-xl bg-white/15 text-white flex items-center justify-center active:scale-95 active:bg-white/25 transition-all"
            >
              <FolderOpen className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4">
          <div className="flex items-stretch gap-6 border-b border-white/15">
            <button
              onClick={() => setRole(PartyRole.CUSTOMER)}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                role === PartyRole.CUSTOMER ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              গ্রাহক
            </button>
            <button
              onClick={() => setRole(PartyRole.SUPPLIER)}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                role === PartyRole.SUPPLIER ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              সরবরাহকারী
            </button>
          </div>
        </div>
      </div>

      {/* Overlapping white "3-in-1" summary card */}
      <div className="shrink-0 px-4 -mt-6 z-10">
        <div className="bg-white rounded-2xl shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)] border border-slate-100 grid grid-cols-3 divide-x divide-slate-100">
          <div className="px-1.5 py-3 text-center min-w-0">
            <p className="text-emerald-700 font-extrabold text-[13px] tracking-tight truncate">
              {formatCurrency(roleSummary.youWillGive)}
            </p>
            <p className="text-[9.5px] font-semibold text-slate-400 mt-1 whitespace-nowrap">আপনি দেবেন</p>
          </div>
          <div className="px-1.5 py-3 text-center min-w-0">
            <p className="text-red-600 font-extrabold text-[13px] tracking-tight truncate">
              {formatCurrency(roleSummary.youWillGet)}
            </p>
            <p className="text-[9.5px] font-semibold text-slate-400 mt-1 whitespace-nowrap">আপনি পাবেন</p>
          </div>
          <Link
            href="/reports"
            className="px-1.5 py-3 flex flex-col items-center justify-center gap-1 active:scale-[0.95] transition-all min-w-0"
          >
            <span className="flex items-center gap-1 text-[#075E9F] font-bold text-[12px] whitespace-nowrap">
              রিপোর্ট দেখুন
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            </span>
          </Link>
        </div>
      </div>

      {/* Utility bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder={role === PartyRole.CUSTOMER ? 'কাস্টমার অনুসন্ধান করুন' : 'সাপ্লায়ার অনুসন্ধান করুন'}
            className="pl-10 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-primary/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={openFilterSheet}
          aria-label="ফিল্টার"
          className={cn(
            'w-14 h-11 shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all relative',
            isFiltered ? 'bg-primary text-primary-foreground' : 'bg-slate-50 text-slate-500 border border-slate-200'
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-[9px] font-bold leading-none">ফিল্টার</span>
          {isFiltered && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>
        <button
          type="button"
          onClick={() => { exportFilteredReportToPDF(); }}
          disabled={isExportingPdf}
          aria-label="PDF রিপোর্ট"
          className="w-14 h-11 shrink-0 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
        >
          <FileText className={cn('w-4 h-4', isExportingPdf && 'animate-pulse')} />
          <span className="text-[9px] font-bold leading-none">{isExportingPdf ? '...' : 'PDF'}</span>
        </button>
      </div>

      {/* Active-filter summary strip — shown when any non-default filter is applied */}
      {isFiltered && (
        <div className="shrink-0 flex items-center gap-2 px-4 pb-2">
          <span className="text-[10px] font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-0.5">
            {[
              { id: 'all', label: 'সব' },
              { id: 'will_get', label: 'আপনি পাবেন' },
              { id: 'will_give', label: 'আপনি দেবেন' },
              { id: 'permanent', label: 'স্থায়ী' },
              { id: 'today', label: 'আজকের বাকি' },
              { id: 'upcoming', label: 'আপকামিং' },
              { id: 'no_date', label: 'তারিখ নেই' },
            ].find(f => f.id === appliedFilter)?.label}
          </span>
          <button
            type="button"
            onClick={() => { setAppliedFilter('all'); setAppliedSort('recent'); }}
            className="ml-auto text-[10px] font-bold text-slate-400 active:text-slate-700"
          >
            রিসেট
          </button>
        </div>
      )}

      {/* Contact feed list — the only scrollable section */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white pb-24">
        {parties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-8 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <User className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">
              {role === PartyRole.CUSTOMER
                ? 'কাস্টমার যোগ করুন এবং দ্রুত বকেয়া কালেকশন করুন'
                : 'সাপ্লায়ার যোগ করুন এবং আপনার হিসাব পরিষ্কার রাখুন'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {parties.map((party, i) => (
              /* Row is a div+onClick so the right-side amount can be a
                 separate tappable button (avoids invalid <button> inside <a>). */
              <div
                key={party.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/party/${party.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/party/${party.id}`)}
                className={cn(
                  'flex items-center justify-between p-4 active:bg-slate-50 transition-all w-full text-left relative cursor-pointer',
                  location === `/party/${party.id}` && 'bg-blue-50/40',
                  'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both'
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div
                  className={cn(
                    'w-[52px] h-[52px] rounded-full flex items-center justify-center font-bold text-lg mr-4 shrink-0',
                    party.balanceType === 'YOU_WILL_GET' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  )}
                >
                  {party.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 pr-3">
                  <div className="flex justify-between items-center mb-1">
                    <p className="font-bold text-slate-900 truncate text-[15px]">{party.name}</p>
                    {party.lastTransactionAt && (
                      <span className="text-[10px] font-medium text-slate-400 shrink-0 ml-2">
                        {formatDistanceToNow(new Date(party.lastTransactionAt), { addSuffix: true, locale: bn })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-slate-500 truncate">{party.phone}</p>
                </div>
                {/* Amount tap → payment request sheet; chevron tap → navigate */}
                <div className="shrink-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRequestModalParty(party);
                    }}
                    aria-label={`${party.name}-এর কাছে অর্থ প্রদানের অনুরোধ করুন`}
                    className="text-right active:scale-95 transition-all"
                  >
                    <p
                      className={cn(
                        'text-[15px] font-bold tracking-tight',
                        party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(party.currentBalance)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 text-right">
                      {party.balanceType === 'YOU_WILL_GET' ? 'পাবেন' : 'দেবেন'}
                    </p>
                  </button>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </div>
              </div>
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>

      {/* Floating FAB */}
      <button
        onClick={() => setIsAddPartyOpen(true)}
        className="absolute right-4 bottom-[76px] z-20 flex items-center gap-2 bg-[#F5A623] text-white font-bold text-sm pl-4 pr-5 py-3.5 rounded-full shadow-[0_8px_24px_-6px_rgba(245,166,35,0.55)] active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        {role === PartyRole.CUSTOMER ? 'কাস্টমার যোগ করুন' : 'সাপ্লায়ার যোগ করুন'}
      </button>

      {/* Sticky bottom nav */}
      <div className="shrink-0 flex items-stretch border-t border-slate-100 bg-white z-10 pb-[var(--safe-bottom)]">
        <button className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[#1B3A6B]">
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-bold">পার্টিস</span>
        </button>
        <Link
          href="/reports"
          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-slate-400 active:text-slate-600 transition-colors"
        >
          <FileText className="w-5 h-5" />
          <span className="text-[10px] font-bold">রিপোর্ট</span>
        </Link>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-slate-400 active:text-slate-600 transition-colors"
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] font-bold">সেটিংস</span>
        </button>
      </div>

      <AddPartyModal open={isAddPartyOpen} onOpenChange={setIsAddPartyOpen} defaultRole={role} />
      <SettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <AddStaffDialog open={isAddStaffOpen} onOpenChange={setIsAddStaffOpen} />
      <RenameStoreDialog open={isRenameStoreOpen} onOpenChange={setIsRenameStoreOpen} />

      {/* ── Advanced filter & sort bottom sheet ─────────────────────────
          Opens when the user taps the ফিল্টার button in the utility bar.
          Pending state is drafted while open; committed on "ফলাফল দেখুন". */}
      {isFilterSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsFilterSheetOpen(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[88vh] overflow-y-auto shadow-2xl">
            {/* Drag handle */}
            <div className="sticky top-0 bg-white pt-4 pb-1 px-5 z-10">
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between mb-1">
                <p className="font-extrabold text-slate-900 text-base">ফিল্টার ও বাছাই</p>
                <button
                  type="button"
                  onClick={() => setIsFilterSheetOpen(false)}
                  className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 active:scale-90 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="px-5 pb-[calc(1.5rem+var(--safe-bottom))]">
              {/* ── Section 1: Filter pills ── */}
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 mt-2">
                মাধ্যমে ফিল্টার
              </p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {[
                  { id: 'all',      label: 'সব' },
                  { id: 'will_get', label: 'আপনি পাবেন' },
                  { id: 'will_give',label: 'আপনি দেবেন' },
                  { id: 'permanent',label: 'স্থায়ী' },
                  { id: 'today',    label: 'আজকের বাকি' },
                  { id: 'upcoming', label: 'আপকামিং' },
                ].map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setPendingFilter(pill.id)}
                    className={cn(
                      'py-2.5 px-1 rounded-xl border text-xs font-semibold text-center transition-all active:scale-[0.97]',
                      pendingFilter === pill.id
                        ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                        : 'bg-white text-slate-600 border-slate-200'
                    )}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
              {/* Full-width pill for the long label */}
              <button
                type="button"
                onClick={() => setPendingFilter('no_date')}
                className={cn(
                  'w-full py-2.5 px-4 rounded-xl border text-xs font-semibold text-left transition-all active:scale-[0.98]',
                  pendingFilter === 'no_date'
                    ? 'bg-[#1B3A6B] text-white border-[#1B3A6B]'
                    : 'bg-white text-slate-600 border-slate-200'
                )}
              >
                কোনো নির্দিষ্ট তারিখ নেই
              </button>

              {/* ── Section 2: Sort radio list ── */}
              <div className="border-t border-slate-100 mt-5 pt-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                  মাধ্যমে বাছাই
                </p>
                <div className="space-y-1">
                  {[
                    { id: 'recent',  label: 'সর্বাধিক সাম্প্রতিক' },
                    { id: 'highest', label: 'সর্বোচ্চ পরিমাণ' },
                    { id: 'name',    label: 'নামের দ্বারা (A–Z)' },
                    { id: 'oldest',  label: 'সব থেকে পুরোনো' },
                    { id: 'lowest',  label: 'সর্বনিম্ন রাশি' },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      className="flex items-center justify-between py-3 border-b border-slate-50 cursor-pointer"
                    >
                      <span className={cn(
                        'text-sm font-medium',
                        pendingSort === opt.id ? 'text-[#1B3A6B] font-bold' : 'text-slate-600'
                      )}>
                        {opt.label}
                      </span>
                      <input
                        type="radio"
                        name="sortOption"
                        value={opt.id}
                        checked={pendingSort === opt.id}
                        onChange={() => setPendingSort(opt.id)}
                        className="w-4 h-4 accent-[#1B3A6B]"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* ── Apply button ── */}
              <button
                type="button"
                onClick={applyFilter}
                className="w-full mt-6 bg-[#1B3A6B] active:bg-[#142d55] text-white font-bold py-4 rounded-2xl text-sm active:scale-[0.98] transition-all shadow-lg"
              >
                ফলাফল দেখুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment request bottom sheet ─────────────────────────────────
          Opens when the user taps the balance amount on a party row.
          SMS fires the native SMS intent; WhatsApp opens wa.me.         */}
      {requestModalParty && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRequestModalParty(null)}
          />
          {/* Sheet card */}
          <div className="relative bg-white rounded-t-3xl px-5 pt-4 pb-[calc(1.5rem+var(--safe-bottom))] shadow-2xl">
            {/* Drag handle */}
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-5">
              <p className="text-sm font-semibold text-slate-600 leading-snug flex-1">
                আপনাকে অর্থ প্রদানের জন্য{' '}
                <span className="text-slate-900 font-extrabold">{requestModalParty.name}</span>
                -এর কাছে অনুরোধ করুন
              </p>
              <button
                type="button"
                onClick={() => setRequestModalParty(null)}
                className="shrink-0 w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 active:scale-90 transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Large amount */}
            <div className="mb-5">
              <p
                className={cn(
                  'text-4xl font-extrabold tracking-tight',
                  requestModalParty.balanceType === 'YOU_WILL_GET'
                    ? 'text-emerald-600'
                    : 'text-red-600',
                )}
              >
                {formatCurrency(requestModalParty.currentBalance)}
              </p>
              <p className="text-xs font-semibold text-slate-400 mt-1">
                {requestModalParty.balanceType === 'YOU_WILL_GET' ? 'পাবেন' : 'দেবেন'}
              </p>
            </div>

            {/* Bank details nudge — tapping opens Settings */}
            <button
              type="button"
              onClick={() => {
                setRequestModalParty(null);
                setIsSettingsOpen(true);
              }}
              className="w-full bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center justify-between mb-5 active:scale-[0.98] transition-all"
            >
              <span className="text-xs font-medium text-blue-800 leading-relaxed text-left pr-2">
                আপনার অ্যাকাউন্টে এই অর্থপ্রদান পেতে ব্যাংকের বিবরণ যোগ করুন
              </span>
              <ChevronRight className="w-4 h-4 text-blue-500 shrink-0" />
            </button>

            {/* Share buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handleShareRequest('sms')}
                className="flex-1 bg-blue-600 active:bg-blue-700 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
              >
                <MessageSquare className="w-4 h-4" />
                SMS
              </button>
              <button
                type="button"
                onClick={() => handleShareRequest('whatsapp')}
                className="flex-1 bg-emerald-500 active:bg-emerald-600 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.97] transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
