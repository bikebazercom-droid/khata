import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useBusinessContext } from '@/lib/businessContext';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import { isOfflineMode } from '@/lib/useAuthConnectivity';
import {
  useListParties,
  getListPartiesQueryKey,
  getGetPartyQueryKey,
  useUpdateParty,
  useGetBusinessSettings,
  getGetBusinessSettingsQueryKey,
  PartyRole,
  DueFilter,
  type Party,
} from '@workspace/api-client-react';
import { useMemo } from 'react';
import { Search, Plus, Settings, User, ChevronRight, UserPlus2, SlidersHorizontal, FileText, Users, Pencil, FolderOpen, X, ScanLine } from 'lucide-react';
import { cn, escapeHtml } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddPartyModal } from '@/components/modals/add-party-modal';
import { BengaliLedgerScanner } from '@/components/modals/bengali-ledger-scanner';
import { SettingsDrawer, loadShopProfile } from '@/components/modals/settings-drawer';
import { AddStaffDialog } from '@/components/modals/add-staff-dialog';
import { RenameStoreDialog } from '@/components/modals/rename-store-dialog';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/i18n';
import { useAppAuth } from '@/App';
import { ENTRY_OUTBOX_CHANGED, listRejectedEntries } from '@/lib/entryOutbox';
import { shareGeneratedFileWithNative } from '@/lib/native-file-export';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { resolveLedgerBookName } from '@/lib/ledger-book-name';
import { LongPressPartyName } from '@/components/long-press-party-name';
import { queuePartyOperation } from '@/lib/partyOutbox';
import { readOfflineIdentity } from '@/lib/offlineSession';
import { isTransientNetworkError } from '@/lib/offlineErrors';

function partyBalanceFontSize(value: string): string {
  const widthInEm = Array.from(value).reduce((width, character) => {
    if (character === '৳') return width + 0.9;
    if (character === ',' || character === '.') return width + 0.35;
    return width + 0.68;
  }, 0);
  const availableWidth = typeof window === 'undefined'
    ? 126
    : Math.min(146, window.innerWidth * 0.33);
  return `${Math.max(10, Math.min(15, availableWidth / (widthInEm * 1.08)))}px`;
}

export function HomeView() {
  const { openSwitcher, businesses, selectedBusinessId, setSelectedBusiness } = useBusinessContext();
  const { role: userRole, userId, businessId } = useAppAuth();
  const queryClient = useQueryClient();
  const activeBusiness = businesses.find((b) => b.id === selectedBusinessId);
  const [role, setRole] = useState<PartyRole>(PartyRole.CUSTOMER);
  const [search, setSearch] = useState('');
  const [location, navigate] = useLocation();
  const openNotifiedParty = useCallback((notificationBusinessId: string, partyId: string) => {
    if (selectedBusinessId !== notificationBusinessId) setSelectedBusiness(notificationBusinessId);
    navigate(`/party/${partyId}`);
  }, [navigate, selectedBusinessId, setSelectedBusiness]);

  const { t, formatCurrency } = useLanguage();

  // ── Advanced filter / sort sheet ────────────────────────────────────────
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
  const [renameTarget, setRenameTarget] = useState<Party | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const businessScopeKey = userId && selectedBusinessId
    ? JSON.stringify([userId, selectedBusinessId])
    : '';
  const [rejectedDraftSummary, setRejectedDraftSummary] = useState({ scope: '', count: 0 });
  const rejectedDraftCount = rejectedDraftSummary.scope === businessScopeKey
    ? rejectedDraftSummary.count
    : 0;

  const { data: settings } = useGetBusinessSettings({ query: { enabled: userRole === 'owner', queryKey: businessScopedQueryKey(getGetBusinessSettingsQueryKey(), selectedBusinessId) } });
  const activeBookName = resolveLedgerBookName(settings?.storeName, activeBusiness?.name);
  const summaryParams = { role };
  const partyParams = { role, search, dueFilter: apiDueFilter };
  const { data: summaryParties = [] } = useListParties(summaryParams, {
    query: { queryKey: businessScopedQueryKey(getListPartiesQueryKey(summaryParams), selectedBusinessId) },
  });
  const { data: queriedParties } = useListParties(partyParams, {
    query: { queryKey: businessScopedQueryKey(getListPartiesQueryKey(partyParams), selectedBusinessId) },
  });

  const renamePartyMutation = useUpdateParty({
    mutation: {
      networkMode: 'always',
      onMutate: async ({ partyId, data }) => {
        const businessScope = selectedBusinessId ?? '__default_business__';
        const listQueries = queryClient.getQueryCache().findAll({
          predicate: (query) => {
            const lastKey = query.queryKey[query.queryKey.length - 1];
            return query.queryKey[0] === 'listParties' &&
              typeof lastKey === 'object' &&
              lastKey !== null &&
              'activeBusinessId' in lastKey &&
              (lastKey as { activeBusinessId?: unknown }).activeBusinessId === businessScope;
          },
        });
        await Promise.all(listQueries.map((query) =>
          queryClient.cancelQueries({ queryKey: query.queryKey, exact: true }),
        ));
        const listSnapshots = listQueries.map((query) => ({
          queryKey: query.queryKey,
          data: queryClient.getQueryData<Party[]>(query.queryKey),
        }));
        const partyKey = businessScopedQueryKey(getGetPartyQueryKey(partyId), selectedBusinessId);
        const previousDetail = queryClient.getQueryData<Party>(partyKey);
        const beforeParty = previousDetail ??
          listSnapshots.map((snapshot) => snapshot.data?.find((party) => party.id === partyId))
            .find((party): party is Party => !!party) ??
          (renameTarget?.id === partyId ? renameTarget : undefined);

        for (const snapshot of listSnapshots) {
          queryClient.setQueryData<Party[]>(snapshot.queryKey, (old) =>
            old?.map((party) => party.id === partyId ? { ...party, ...data } : party),
          );
        }
        if (beforeParty) {
          queryClient.setQueryData<Party>(partyKey, { ...beforeParty, ...data });
        }

        return { listSnapshots, partyKey, previousDetail, beforeParty };
      },
      onError: async (error, variables, context) => {
        const identity = readOfflineIdentity();
        const activeBusinessId = selectedBusinessId ?? identity?.businessId;
        if (isTransientNetworkError(error) && identity && activeBusinessId && context?.beforeParty) {
          try {
            const optimisticParty = { ...context.beforeParty, ...variables.data };
            await queuePartyOperation({
              id: crypto.randomUUID(),
              actorId: identity.userId,
              businessId: activeBusinessId,
              partyId: variables.partyId,
              kind: 'update',
              data: variables.data,
              beforeParty: context.beforeParty,
              optimisticParty,
              createdAt: new Date().toISOString(),
              status: 'pending',
            });
            toast.success('নাম ডিভাইসে সেভ হয়েছে; সংযোগ ফিরলে সিঙ্ক হবে');
            setRenameTarget(null);
            return;
          } catch {
            toast.error('অফলাইন স্টোরেজে নাম সেভ করা যায়নি');
          }
        }

        if (context) {
          for (const snapshot of context.listSnapshots) {
            if (snapshot.data) queryClient.setQueryData(snapshot.queryKey, snapshot.data);
          }
          if (context.previousDetail) {
            queryClient.setQueryData(context.partyKey, context.previousDetail);
          } else {
            queryClient.removeQueries({ queryKey: context.partyKey, exact: true });
          }
        }
        toast.error('নাম পরিবর্তন করা যায়নি');
      },
      onSuccess: (updatedParty, variables, context) => {
        if (context) {
          queryClient.setQueryData(context.partyKey, updatedParty);
          for (const snapshot of context.listSnapshots) {
            queryClient.setQueryData<Party[]>(snapshot.queryKey, (old) =>
              old?.map((party) => party.id === variables.partyId ? updatedParty : party),
            );
          }
        }
        toast.success('নাম পরিবর্তন করা হয়েছে');
        setRenameTarget(null);
      },
      onSettled: (_data, error, variables) => {
        if (error && isTransientNetworkError(error)) return;
        queryClient.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPartyQueryKey(variables.partyId) });
      },
    },
  });

  const openPartyRename = (party: Party) => {
    if (userRole !== 'owner') return;
    setRenameTarget(party);
    setRenameName(party.name);
    setRenameError('');
  };

  const savePartyRename = () => {
    if (!renameTarget) return;
    const trimmedName = renameName.trim();
    if (!trimmedName) {
      setRenameError('নাম খালি রাখা যাবে না');
      return;
    }
    if (trimmedName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    renamePartyMutation.mutate({ partyId: renameTarget.id, data: { name: trimmedName } });
  };
  const offlineParties = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    return summaryParties.filter((party) => {
      if (term && !party.name.toLocaleLowerCase().includes(term) && !party.phone.toLocaleLowerCase().includes(term)) {
        return false;
      }
      if (apiDueFilter === DueFilter.DUE_TODAY && party.dueDate !== today) return false;
      if (apiDueFilter === DueFilter.UPCOMING && (!party.dueDate || party.dueDate <= today)) return false;
      if (apiDueFilter === DueFilter.NO_DUE_DATE && party.dueDate) return false;
      return true;
    });
  }, [summaryParties, search, apiDueFilter]);
  const rawParties = isOfflineMode() ? offlineParties : (queriedParties ?? []);

  useEffect(() => {
    if (userRole !== 'owner' || !userId || !selectedBusinessId) return;
    let active = true;
    const refresh = () => {
      const includeLegacyUnscoped = businessId === selectedBusinessId;
      void listRejectedEntries(userId, selectedBusinessId, includeLegacyUnscoped)
        .then((entries) => {
          if (active) setRejectedDraftSummary({ scope: businessScopeKey, count: entries.length });
        })
        .catch(() => {
          if (active) setRejectedDraftSummary({ scope: businessScopeKey, count: 0 });
        });
    };
    refresh();
    window.addEventListener(ENTRY_OUTBOX_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(ENTRY_OUTBOX_CHANGED, refresh);
    };
  }, [userRole, userId, businessId, selectedBusinessId, businessScopeKey]);

  const parties = useMemo(() => {
    let result = rawParties;
    if (appliedFilter === 'will_get') result = result.filter(p => p.balanceType === 'YOU_WILL_GET');
    if (appliedFilter === 'will_give') result = result.filter(p => p.balanceType === 'YOU_WILL_GIVE');
    switch (appliedSort) {
      case 'highest': return [...result].sort((a, b) => b.currentBalance - a.currentBalance);
      case 'lowest':  return [...result].sort((a, b) => a.currentBalance - b.currentBalance);
      case 'name':    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'bn'));
      case 'oldest':  return [...result].sort((a, b) => {
        const aT = a.lastTransactionAt ? new Date(a.lastTransactionAt).getTime() : 0;
        const bT = b.lastTransactionAt ? new Date(b.lastTransactionAt).getTime() : 0;
        return aT - bT;
      });
      default: return result;
    }
  }, [rawParties, appliedFilter, appliedSort]);

  const roleSummary = useMemo(() => {
    let youWillGet = 0;
    let youWillGive = 0;
    for (const p of summaryParties) {
      if (p.balanceType === 'YOU_WILL_GET') youWillGet += p.currentBalance;
      else youWillGive += p.currentBalance;
    }
    return { youWillGet, youWillGive };
  }, [summaryParties]);

  const handleInstantShare = useCallback(async (
    e: React.MouseEvent,
    party: { name: string; phone?: string | null; currentBalance: number; balanceType: string; lastTransactionAt?: string | Date | null }
  ) => {
    e.stopPropagation();
    const isGet       = party.balanceType === 'YOU_WILL_GET';
    const balanceColor = isGet ? '#065F46' : '#991B1B';
    const amountLabel  = isGet ? t('receiptGot') : t('receiptGave');
    const formatted    = formatCurrency(party.currentBalance);
    const dateStr = party.lastTransactionAt
      ? (() => {
          const d = new Date(party.lastTransactionAt as string);
          const date = d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: '2-digit' });
          const time = d.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true });
          return `${date} • ${time}`;
        })()
      : '';

    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:600px;background:#fff;padding:32px;font-family:sans-serif;border-radius:12px;';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="background:#004B93;color:#fff;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:bold;flex-shrink:0;">+</div>
          <div>
            <div style="font-size:20px;font-weight:700;color:#111827;">${party.phone || party.name}</div>
            <div style="font-size:14px;color:#6B7280;margin-top:4px;">${dateStr}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:26px;font-weight:800;color:${balanceColor};">৳ ${formatted}</div>
          <div style="font-size:14px;color:#374151;margin-top:5px;">${amountLabel}</div>
        </div>
      </div>
      <hr style="border:0;border-top:1px solid #E5E7EB;margin:18px 0;" />
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:18px;color:#111827;font-weight:500;">${t('receiptBalance')}</div>
        <div style="font-size:22px;font-weight:800;color:${balanceColor};">৳ ${formatted}</div>
      </div>
    `;
    document.body.appendChild(el);

    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 3, useCORS: true, logging: false });
      document.body.removeChild(el);

      const jpgDataUrl = canvas.toDataURL('image/jpeg', 0.98);
      const filename   = `Banglakhata_${party.name}_${new Date().toISOString().split('T')[0]}.jpg`;

      const byteStr = atob(jpgDataUrl.split(',')[1]);
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: 'image/jpeg' });
      const file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Balance Receipt', text: `${party.name} — ${formatted}` });
          return;
        } catch (shareErr: unknown) {
          if (shareErr instanceof Error && shareErr.name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = jpgDataUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (err) {
      if (document.body.contains(el)) document.body.removeChild(el);
      console.error('Instant share error:', err);
    }
  }, [t, formatCurrency]);

  const exportFilteredReportToPDF = useCallback(async () => {
    setIsExportingPdf(true);

    const shopProfile   = loadShopProfile();
    const storeName = resolveLedgerBookName(
      settings?.storeName,
      activeBusiness?.name,
      shopProfile.businessName,
    ) ?? 'Banglakhata';
    const safeStoreName = escapeHtml(storeName);
    const roleLabel     = role === PartyRole.CUSTOMER ? t('customer') : t('supplier');
    const nameColHeader = role === PartyRole.CUSTOMER ? t('pdfName') : t('pdfSupplierNameCol');
    const statementTitle = role === PartyRole.CUSTOMER ? t('pdfCustomerStatement') : t('pdfSupplierStatement');
    const dateStr       = new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
    const footerAddress = shopProfile.address || '';
    const footerPhone   = shopProfile.phone   || '';

    let filteredGet  = 0;
    let filteredGive = 0;
    for (const p of parties) {
      if (p.balanceType === 'YOU_WILL_GET') filteredGet  += p.currentBalance;
      else                                  filteredGive += p.currentBalance;
    }
    const netBalance = filteredGet - filteredGive;

    const filterDisplayLabel: Record<string, string> = {
      all:       t('all'),
      will_get:  t('youWillGet'),
      will_give: t('youWillGive'),
      today:     t('dueToday'),
      upcoming:  t('upcoming'),
      permanent: t('permanent'),
      no_date:   t('noDate'),
    };
    const countTag = filterDisplayLabel[appliedFilter] ?? t('all');
    const asOfLabel = `(${t('pdfAsOfToday')} — ${dateStr})`;

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
      const debitCell = p.balanceType === 'YOU_WILL_GIVE'
        ? `<td style="padding:10px;border:1px solid #000;text-align:right;background:#FEF2F2;color:#000;font-weight:500;">৳${p.currentBalance.toFixed(2)}</td>`
        : `<td style="padding:10px;border:1px solid #000;background:#FEF2F2;"></td>`;
      const creditCell = p.balanceType === 'YOU_WILL_GET'
        ? `<td style="padding:10px;border:1px solid #000;text-align:right;background:#F0FDF4;color:#000;font-weight:500;">৳${p.currentBalance.toFixed(2)}</td>`
        : `<td style="padding:10px;border:1px solid #000;background:#F0FDF4;"></td>`;
      return `
        <tr style="vertical-align:top;">
          <td style="padding:10px;border:1px solid #000;font-weight:500;word-break:break-word;">${p.name  || '—'}</td>
          <td style="padding:10px;border:1px solid #000;">${p.phone || '—'}</td>
          ${debitCell}
          ${creditCell}
          <td style="padding:10px;border:1px solid #000;text-align:center;">${dateCell}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <!-- 1. Top Navy Header -->
      <div style="background:#003366;display:flex;justify-content:space-between;align-items:center;padding:16px 24px;color:#fff;font-size:20px;font-weight:bold;box-sizing:border-box;">
        <span>${safeStoreName}</span>
        <span style="letter-spacing:0.5px;">📘 Banglakhata</span>
      </div>

      <div style="padding:30px;box-sizing:border-box;">
        <!-- 2. Title -->
        <div style="text-align:center;margin-bottom:25px;">
          <div style="font-size:24px;font-weight:bold;color:#000;letter-spacing:0.5px;">${statementTitle}</div>
          <div style="font-size:15px;color:#555;font-weight:500;margin-top:6px;">${asOfLabel}</div>
        </div>

        <!-- 3. Summary Cards -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:25px;text-align:center;border:1px solid #E5E7EB;">
          <tr>
            <td style="width:33.33%;padding:16px;border-right:1px solid #E5E7EB;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">${t('pdfTotalExpense')}</div>
              <div style="font-size:18px;font-weight:bold;color:#DC2626;">৳${filteredGive.toFixed(2)}</div>
            </td>
            <td style="width:33.33%;padding:16px;border-right:1px solid #E5E7EB;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">${t('pdfTotalCredit')}</div>
              <div style="font-size:18px;font-weight:bold;color:#16A34A;">৳${filteredGet.toFixed(2)}</div>
            </td>
            <td style="width:33.33%;padding:16px;">
              <div style="font-size:14px;color:#666;margin-bottom:6px;">${t('pdfTotalBalance')}</div>
              <div style="font-size:18px;font-weight:bold;color:${netBalance >= 0 ? '#16A34A' : '#DC2626'};">
                ৳${Math.abs(netBalance).toFixed(2)} ${netBalance >= 0 ? 'ক্রেডিট' : 'ডেবিট'}
              </div>
            </td>
          </tr>
        </table>

        <!-- Count label -->
        <div style="font-size:15px;font-weight:bold;color:#000;margin-bottom:12px;">
          ${roleLabel}: ${parties.length} (${countTag})
        </div>

        <!-- 4. Party Table -->
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#000;">
          <thead>
            <tr style="background:#F8FAFC;font-weight:bold;">
              <th style="padding:10px;border:1px solid #000;width:22%;text-align:left;">${nameColHeader}</th>
              <th style="padding:10px;border:1px solid #000;width:20%;text-align:left;">${t('pdfPhone')}</th>
              <th style="padding:10px;border:1px solid #000;width:18%;text-align:right;background:#FEF2F2;">${t('pdfDebit')}</th>
              <th style="padding:10px;border:1px solid #000;width:18%;text-align:right;background:#F0FDF4;">${t('pdfCredit')}</th>
              <th style="padding:10px;border:1px solid #000;width:22%;text-align:center;">${t('pdfLastTx')}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr style="background:#F1F5F9;font-weight:bold;">
              <td style="padding:12px 10px;border:1px solid #000;">${t('pdfGrandTotal')}</td>
              <td style="padding:12px 10px;border:1px solid #000;"></td>
              <td style="padding:12px 10px;border:1px solid #000;text-align:right;background:#FEF2F2;color:#DC2626;">৳${filteredGive.toFixed(2)}</td>
              <td style="padding:12px 10px;border:1px solid #000;text-align:right;background:#F0FDF4;color:#16A34A;">৳${filteredGet.toFixed(2)}</td>
              <td style="padding:12px 10px;border:1px solid #000;"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 5. Deep Navy Footer Strip -->
      <div style="background:#003366;color:#fff;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;margin-top:40px;font-size:13px;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span>${t('pdfFooterCta')}</span>
          <span style="background:#fff;color:#003366;padding:4px 10px;font-weight:bold;border-radius:4px;">${t('pdfInstall')}</span>
        </div>
        <div>
          ${footerPhone ? `📞 ${footerPhone}` : t('pdfFooterSupport')} | ${t('pdfFooterTerms')}
        </div>
      </div>
    `;

    document.body.appendChild(container);

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });

      document.body.removeChild(container);

      const imgData   = canvas.toDataURL('image/jpeg', 0.95);
      const pdf       = new jsPDF('p', 'mm', 'a4');
      const pdfW      = 210;
      const pdfH      = 297;
      const imgH      = (canvas.height * pdfW) / canvas.width;

      let yOffset = 0;
      let firstPage = true;
      while (yOffset < imgH) {
        if (!firstPage) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -yOffset, pdfW, imgH);
        yOffset   += pdfH;
        firstPage  = false;
      }

      const roleTag  = role === PartyRole.CUSTOMER ? 'Customer' : 'Supplier';
      const filename = `Banglakhata_${roleTag}_${new Date().toISOString().split('T')[0]}.pdf`;
      const pdfBlob  = pdf.output('blob');
      const nativeShare = await shareGeneratedFileWithNative(pdfBlob, {
        fileName: filename,
        mimeType: 'application/pdf',
        title: statementTitle,
      });
      if (nativeShare) return;

      const pdfFile  = new File([pdfBlob], filename, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({ files: [pdfFile], title: `${statementTitle}`, text: `${storeName}` });
        } catch (shareErr) {
          if ((shareErr as DOMException).name !== 'AbortError') pdf.save(filename);
        }
      } else {
        pdf.save(filename);
      }
    } catch (err) {
      if (document.body.contains(container)) document.body.removeChild(container);
      console.error('PDF export failed:', err);
      toast.error(t('pdfError'));
    } finally {
      setIsExportingPdf(false);
    }
  }, [parties, role, appliedFilter, settings?.storeName, activeBusiness?.name, t]);

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* Fixed deep-blue top header */}
      <div className="shrink-0 bg-[#1B3A6B] pb-9 z-10">
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(1rem+var(--safe-top))]">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/logo-icon.svg`}
              alt="Banglakhata"
              className="w-9 h-9 shrink-0"
            />
            <button
              type="button"
              onClick={userRole === 'owner' ? openSwitcher : undefined}
              className={cn("flex items-center gap-1.5 transition-opacity min-w-0", userRole === 'owner' ? "active:opacity-75" : "")}
              aria-label="বাংলা খাতা"
            >
              <h1 className="font-extrabold tracking-tight text-[15px] text-white truncate max-w-[120px]">
                {activeBookName || t('loading')}
              </h1>
              {userRole === 'owner' && <ChevronRight className="w-3.5 h-3.5 text-white/60 shrink-0 rotate-90" />}
            </button>
            {userRole === 'owner' && (
              <button
                onClick={() => setIsRenameStoreOpen(true)}
                aria-label="দোকানের নাম সম্পাদনা করুন"
                className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-white/60 active:bg-white/15 active:text-white transition-all"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {userRole === 'owner' ? (
              <>
                <NotificationBell businessId={selectedBusinessId} onOpenParty={openNotifiedParty} />
                <button
                  onClick={() => navigate('/access')}
                  className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-bold px-3 py-2 rounded-xl active:scale-95 transition-all"
                >
                  <UserPlus2 className="w-3.5 h-3.5" />
                  অ্যাক্সেস
                </button>
                <button
                  onClick={() => navigate('/staff-deployment')}
                  aria-label="ডিউটি ফোল্ডার"
                  className="w-9 h-9 rounded-xl bg-white/15 text-white flex items-center justify-center active:scale-95 active:bg-white/25 transition-all"
                >
                  <FolderOpen className="w-[18px] h-[18px]" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-bold px-3 py-2 rounded-xl active:scale-95 transition-all"
              >
                <Settings className="w-3.5 h-3.5" />
                সেটিংস
              </button>
            )}
          </div>
        </div>

        {/* Tabs + Scan button */}
        <div className="px-4">
          <div className="flex items-stretch gap-6 border-b border-white/15">
            <button
              onClick={() => setRole(PartyRole.CUSTOMER)}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                role === PartyRole.CUSTOMER ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              {t('customer')}
            </button>
            <button
              onClick={() => setRole(PartyRole.SUPPLIER)}
              className={cn(
                'text-sm font-bold pb-2.5 pt-1 transition-all border-b-2',
                role === PartyRole.SUPPLIER ? 'text-white border-white' : 'text-white/60 border-transparent'
              )}
            >
              {t('supplier')}
            </button>
            <div className="flex-1" />
            {userRole === 'owner' && (
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="flex items-center gap-1.5 text-white/80 hover:text-white text-[12px] font-bold pb-2.5 pt-1 transition-all active:scale-95"
                aria-label="বাংলা খাতা স্ক্যান করুন"
              >
                <ScanLine className="w-4 h-4" />
                স্ক্যান
              </button>
            )}
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
            <p className="text-[9.5px] font-semibold text-slate-400 mt-1 whitespace-nowrap">{t('youWillGive')}</p>
          </div>
          <div className="px-1.5 py-3 text-center min-w-0">
            <p className="text-red-600 font-extrabold text-[13px] tracking-tight truncate">
              {formatCurrency(roleSummary.youWillGet)}
            </p>
            <p className="text-[9.5px] font-semibold text-slate-400 mt-1 whitespace-nowrap">{t('youWillGet')}</p>
          </div>
          {userRole === 'owner' ? (
            <button
              type="button"
              onClick={() => navigate(`/reports?role=${role === PartyRole.CUSTOMER ? 'customer' : 'supplier'}`)}
              className="px-1.5 py-3 flex flex-col items-center justify-center gap-1 active:scale-[0.95] transition-all min-w-0"
            >
              <span className="flex items-center gap-1 text-[#075E9F] font-bold text-[12px] whitespace-nowrap">
                {t('viewReport')}
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              </span>
            </button>
          ) : (
            <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-1 min-w-0" />
          )}
        </div>
      </div>

      {userRole === 'owner' && rejectedDraftCount > 0 && (
        <button
          type="button"
          onClick={() => navigate('/rejected-drafts')}
          className="shrink-0 mx-4 mt-2 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left active:bg-amber-100"
        >
          <FileText className="h-4 w-4 shrink-0 text-amber-800" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold text-amber-950">প্রত্যাখ্যাত খসড়া</span>
            <span className="block truncate text-[11px] text-amber-800">সার্ভারের কারণ দেখুন</span>
          </span>
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-950">
            {rejectedDraftCount.toLocaleString('bn-BD')}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-amber-800" />
        </button>
      )}

      {/* Utility bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder={role === PartyRole.CUSTOMER ? t('searchCustomer') : t('searchSupplier')}
            className="pl-10 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-primary/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={openFilterSheet}
          aria-label={t('filter')}
          className={cn(
            'w-14 h-11 shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all relative',
            isFiltered ? 'bg-primary text-primary-foreground' : 'bg-slate-50 text-slate-500 border border-slate-200'
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-[9px] font-bold leading-none">{t('filter')}</span>
          {isFiltered && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>
        {userRole === 'owner' && (
          <button
            type="button"
            onClick={() => { exportFilteredReportToPDF(); }}
            disabled={isExportingPdf}
            aria-label="PDF"
            className="w-14 h-11 shrink-0 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
          >
            <FileText className={cn('w-4 h-4', isExportingPdf && 'animate-pulse')} />
            <span className="text-[9px] font-bold leading-none">{isExportingPdf ? '...' : 'পিডিএফ'}</span>
          </button>
        )}
      </div>

      {/* Active-filter summary strip */}
      {isFiltered && (
        <div className="shrink-0 flex items-center gap-2 px-4 pb-2">
          <span className="text-[10px] font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-0.5">
            {[
              { id: 'all',       label: t('all') },
              { id: 'will_get',  label: t('youWillGet') },
              { id: 'will_give', label: t('youWillGive') },
              { id: 'permanent', label: t('permanent') },
              { id: 'today',     label: t('dueToday') },
              { id: 'upcoming',  label: t('upcoming') },
              { id: 'no_date',   label: t('noDate') },
            ].find(f => f.id === appliedFilter)?.label}
          </span>
          <button
            type="button"
            onClick={() => { setAppliedFilter('all'); setAppliedSort('recent'); }}
            className="ml-auto text-[10px] font-bold text-slate-400 active:text-slate-700"
          >
            {t('reset')}
          </button>
        </div>
      )}

      {/* Contact feed list */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white pb-24">
        {parties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-8 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3">
              <User className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">
              {role === PartyRole.CUSTOMER ? t('emptyCustomer') : t('emptySupplier')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {parties.map((party, i) => (
              <div
                key={party.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/party/${party.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/party/${party.id}`)}
                className={cn(
                  'flex items-center justify-between gap-3 p-4 active:bg-slate-50 transition-all w-full text-left relative cursor-pointer',
                  location === `/party/${party.id}` && 'bg-blue-50/40',
                  'animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-both'
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div
                  className={cn(
                    'w-[52px] h-[52px] rounded-full flex items-center justify-center font-bold text-lg shrink-0',
                    party.balanceType === 'YOU_WILL_GET' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  )}
                >
                  {party.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="mb-1 min-w-0">
                    <LongPressPartyName
                      name={party.name}
                      canRename={userRole === 'owner'}
                      onClick={() => navigate(`/party/${party.id}`)}
                      onLongPress={() => openPartyRename(party)}
                    />
                  </div>
                  <p className="text-xs font-medium text-slate-500 truncate">{party.phone}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5 max-w-[46%]">
                  <button
                    type="button"
                    onClick={userRole === 'owner' ? (e) => handleInstantShare(e, party) : undefined}
                    disabled={userRole !== 'owner'}
                    className="min-w-0 text-right active:scale-95 transition-transform"
                    aria-label={`${party.name} balance`}
                  >
                    <p
                      style={{ fontSize: partyBalanceFontSize(formatCurrency(party.currentBalance)) }}
                      className={cn(
                        'font-bold tracking-tight leading-tight whitespace-nowrap',
                        party.balanceType === 'YOU_WILL_GET' ? 'text-emerald-600' : 'text-red-600'
                      )}
                    >
                      {formatCurrency(party.currentBalance)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 text-right">
                      {party.balanceType === 'YOU_WILL_GET' ? t('get') : t('give')}
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
      {userRole === 'owner' && (
        <button
          onClick={() => setIsAddPartyOpen(true)}
          className="absolute right-4 bottom-[76px] z-20 flex items-center gap-2 bg-[#F5A623] text-white font-bold text-sm pl-4 pr-5 py-3.5 rounded-full shadow-[0_8px_24px_-6px_rgba(245,166,35,0.55)] active:scale-95 transition-all"
        >
          <Plus className="w-4 h-4" />
          {t('addCustomer')}
        </button>
      )}

      {/* Sticky bottom nav */}
      <div className="shrink-0 flex items-stretch border-t border-slate-100 bg-white z-10 pb-[var(--safe-bottom)]">
        <button className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[#1B3A6B]">
          <Users className="w-5 h-5" />
          <span className="text-[10px] font-bold">{t('parties')}</span>
        </button>
        {userRole === 'owner' && (
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-slate-400 active:text-slate-600 transition-colors"
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] font-bold">{t('settings')}</span>
          </button>
        )}
      </div>

      <AddPartyModal open={isAddPartyOpen} onOpenChange={setIsAddPartyOpen} defaultRole={role} />
      <SettingsDrawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <AddStaffDialog open={isAddStaffOpen} onOpenChange={setIsAddStaffOpen} />
      <RenameStoreDialog open={isRenameStoreOpen} onOpenChange={setIsRenameStoreOpen} />
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open && !renamePartyMutation.isPending) {
            setRenameTarget(null);
            setRenameError('');
          }
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>গ্রাহক / সরবরাহকারীর নাম পরিবর্তন</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            {renameTarget?.name} — নতুন নাম লিখুন
          </p>
          <Input
            autoFocus
            value={renameName}
            onChange={(event) => {
              setRenameName(event.target.value);
              setRenameError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') savePartyRename();
            }}
            maxLength={120}
            placeholder="নাম লিখুন"
            className={cn('h-12 rounded-xl font-semibold', renameError && 'border-red-400')}
          />
          {renameError && <p className="text-xs font-semibold text-red-600">{renameError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={renamePartyMutation.isPending}
              onClick={() => setRenameTarget(null)}
            >
              বাতিল
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={renamePartyMutation.isPending}
              onClick={savePartyRename}
            >
              {renamePartyMutation.isPending ? 'সেভ হচ্ছে…' : 'সেভ করুন'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Advanced filter & sort bottom sheet ── */}
      {isFilterSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsFilterSheetOpen(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[88vh] overflow-y-auto shadow-2xl">
            {/* Drag handle */}
            <div className="sticky top-0 bg-white pt-4 pb-1 px-5 z-10">
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between mb-1">
                <p className="font-extrabold text-slate-900 text-base">{t('filterAndSort')}</p>
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
                {t('filterBy')}
              </p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {[
                  { id: 'all',       label: t('all') },
                  { id: 'will_get',  label: t('youWillGet') },
                  { id: 'will_give', label: t('youWillGive') },
                  { id: 'permanent', label: t('permanent') },
                  { id: 'today',     label: t('dueToday') },
                  { id: 'upcoming',  label: t('upcoming') },
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
                {t('noSpecificDate')}
              </button>

              {/* ── Section 2: Sort radio list ── */}
              <div className="border-t border-slate-100 mt-5 pt-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                  {t('sortBy')}
                </p>
                <div className="space-y-1">
                  {[
                    { id: 'recent',  label: t('mostRecent') },
                    { id: 'highest', label: t('highestAmount') },
                    { id: 'name',    label: t('byName') },
                    { id: 'oldest',  label: t('oldest') },
                    { id: 'lowest',  label: t('lowestAmount') },
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
                {t('showResults')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isScannerOpen && (
        <BengaliLedgerScanner
          onClose={() => setIsScannerOpen(false)}
          onSuccess={() => setIsScannerOpen(false)}
        />
      )}

    </div>
  );
}
