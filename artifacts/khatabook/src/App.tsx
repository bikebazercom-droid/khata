import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ClerkProvider, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { MainLayout } from '@/components/layout/main-layout';
import { ConnectionStateProvider, useConnectionState } from '@/context/connection-state';
import { LandingPage } from '@/pages/landing';
import { PrivacyPolicyPage } from '@/pages/privacy-policy';
import { SupportPage } from '@/pages/support';
import { fetchMe } from '@/lib/phoneAuth';
import { authMeQueryKey } from '@/lib/authQueryKeys';
import { useRealtimeSync } from '@/lib/useRealtimeSync';
import { useRetryPendingUploads } from '@/lib/useRetryPendingUploads';
import { BusinessContextProvider } from '@/lib/businessContext';
import type { BusinessInfo } from '@/lib/businessContext';
import { BusinessSwitcherDrawer } from '@/components/modals/business-switcher-drawer';
import { LanguageProvider } from '@/lib/i18n';
import { drainEntries, ENTRY_OUTBOX_CHANGED } from '@/lib/entryOutbox';
import { applyQueuedPartyOperations, drainPartyOperations, PARTY_OUTBOX_CHANGED, PARTY_OUTBOX_REJECTED } from '@/lib/partyOutbox';
import { clearAllPendingUploads } from '@/lib/pendingUploads';
import { useBusinessContext } from '@/lib/businessContext';
import { isNetworkWriteAuthorized, isOfflineMode, markServerReauthenticated, revokeNetworkWrites, useAuthConnectivity } from '@/lib/useAuthConnectivity';
import { clearLocalLogoutPending, clearOfflineIdentity, isLocalLogoutPending, readOfflineIdentity, saveOfflineIdentity } from '@/lib/offlineSession';
import { clearPersistedQueries, persistCache, restorePersistedQueries, setQueryPersistenceScope } from '@/lib/queryPersister';
import { EntrySavedFeedbackHost } from '@/components/ui/entry-saved-feedback';
import { lazyWithChunkRecovery } from '@/lib/lazyWithChunkRecovery';
import {
  getGetDashboardSummaryQueryKey,
  getGetPartyQueryKey,
  getListGlobalLedgerEntriesQueryKey,
  getListLedgerEntriesQueryKey,
  getListPartiesQueryKey,
  getListNotificationsQueryKey,
  useMarkNotificationRead,
  useRemoveOwnerPushToken,
  useRegisterOwnerPushToken,
} from '@workspace/api-client-react';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';
import {
  NATIVE_PUSH_STATUS_EVENT,
  NATIVE_PUSH_TOKEN_EVENT,
  OPEN_NOTIFICATION_EVENT,
  OWNER_PUSH_REGISTRATION_EVENT,
  STORED_OWNER_PUSH_TOKEN_KEY,
} from '@/lib/nativePushBridge';

const HomeView = lazyWithChunkRecovery(() => import('@/pages/home').then((module) => ({ default: module.HomeView })));
const PartyView = lazyWithChunkRecovery(() => import('@/pages/party-view').then((module) => ({ default: module.PartyView })));
const PartyProfileView = lazyWithChunkRecovery(() => import('@/pages/party-profile').then((module) => ({ default: module.PartyProfileView })));
const TransactionDetailPage = lazyWithChunkRecovery(() => import('@/pages/transaction-detail').then((module) => ({ default: module.TransactionDetailPage })));
const ReportView = lazyWithChunkRecovery(() => import('@/pages/report-view').then((module) => ({ default: module.ReportView })));
const PartyReportView = lazyWithChunkRecovery(() => import('@/pages/party-report-view').then((module) => ({ default: module.PartyReportView })));
const StaffDeploymentPage = lazyWithChunkRecovery(() => import('@/pages/staff-deployment').then((module) => ({ default: module.StaffDeploymentPage })));
const AccessPage = lazyWithChunkRecovery(() => import('@/pages/access').then((module) => ({ default: module.AccessPage })));
const RejectedDraftsPage = lazyWithChunkRecovery(() => import('@/pages/rejected-drafts').then((module) => ({ default: module.RejectedDraftsPage })));
const SignInPage = lazyWithChunkRecovery(() => import('@/pages/sign-in').then((module) => ({ default: module.SignInPage })));
const SignUpPage = lazyWithChunkRecovery(() => import('@/pages/sign-up').then((module) => ({ default: module.SignUpPage })));
const NotFound = lazyWithChunkRecovery(() => import('@/pages/not-found'));

// ─── Clerk setup ──────────────────────────────────────────────────────────────

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Strip the basePath prefix Clerk appends (Clerk gives full paths, wouter
// setLocation prepends the base — avoid doubling).
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#0f172a',
    colorForeground: '#0f172a',
    colorMutedForeground: '#64748b',
    colorDanger: '#ef4444',
    colorBackground: '#ffffff',
    colorInput: '#f1f5f9',
    colorInputForeground: '#0f172a',
    colorNeutral: '#e2e8f0',
    fontFamily: 'Inter, sans-serif',
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg border border-slate-200',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-slate-900',
    headerSubtitle: 'text-slate-500',
    socialButtonsBlockButtonText: 'text-slate-700',
    formFieldLabel: 'text-slate-700',
    footerActionLink: 'text-sky-600',
    footerActionText: 'text-slate-500',
    dividerText: 'text-slate-400',
    identityPreviewEditButton: 'text-sky-600',
    formFieldSuccessText: 'text-green-600',
    alertText: 'text-red-600',
    logoBox: 'py-2',
    logoImage: 'w-12 h-12',
    socialButtonsBlockButton: 'border border-slate-200',
    formButtonPrimary: 'bg-slate-900 hover:bg-slate-800',
    formFieldInput: 'border-slate-200',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-slate-200',
    alert: 'bg-red-50',
    otpCodeFieldInput: 'border-slate-200',
    formFieldRow: '',
    main: '',
  },
};

// ─── Query client ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached results remain available offline; reconnects refresh them in
      // the background without blocking the current screen.
      networkMode: 'offlineFirst',
      //
      // staleTime: 5 min — reduces unnecessary background refetches on
      // every tab switch or component mount. SSE-driven invalidateQueries
      // already handles cross-device updates instantly; the staleTime is
      // just a ceiling on "how long can data stay fresh without SSE".
      staleTime: 5 * 60 * 1000,
      //
      // Keep successful results in memory only; the browser no longer stores
      // ledger query snapshots in localStorage.
      gcTime: 24 * 60 * 60 * 1000,
      //
      // refetchOnWindowFocus: false — the SSE connection + visibilitychange
      // listener (in useRealtimeSync) already perform a full invalidation
      // when the user returns to the tab after ≥60 s. An additional
      // refetchOnWindowFocus would trigger duplicate fetches on every
      // Alt-Tab and unnecessarily drain mobile data.
      refetchOnWindowFocus: false,
      //
      // refetchOnReconnect: true — still resume fetches when the browser
      // network interface comes back (complements the SSE reconnect path).
      refetchOnReconnect: true,
      //
      // retry: 1 — allow one automatic retry for transient network errors
      // (the previous `false` setting caused permanent failures on brief
      // connectivity blips). SSE-driven invalidation handles longer outages.
      retry: 1,
    },
  },
});
persistCache(queryClient);

// ─── Real-time sync ───────────────────────────────────────────────────────────

/**
 * Mounts the SSE subscription only when the user is authenticated so we don't
 * attempt an un-authed connection on the landing page.
 * Must be rendered inside both ClerkProvider and QueryClientProvider.
 */
function RealtimeSyncManager() {
  const { isAuthenticated, userId, role, businessId } = useAppAuth();
  const { selectedBusinessId, setSelectedBusiness } = useBusinessContext();
  const { setIsOnline } = useConnectionState();
  useRealtimeSync(isAuthenticated, setIsOnline);
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const markNotificationRead = useMarkNotificationRead();
  const activeScope = useRef('');
  const activeBusinessId = selectedBusinessId ?? businessId;
  const scope = isAuthenticated && userId ? JSON.stringify([userId, activeBusinessId]) : '';
  activeScope.current = scope;
  useEffect(() => {
    if (!scope || !userId) return;
    activeScope.current = scope;
    const stillCurrent = () => isNetworkWriteAuthorized() && activeScope.current === scope;
    const reconcile = () => {
      void (async () => {
        await applyQueuedPartyOperations(qc, userId, activeBusinessId ?? '');
        await drainPartyOperations(userId, activeBusinessId, stillCurrent, () => {
          if (activeScope.current === scope) {
            void qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
            void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
          }
        }, 'upserts');
        await drainEntries(userId, activeBusinessId, stillCurrent, (entry) => {
          if (activeScope.current !== scope) return;
          const affectedPartyIds = new Set([
            entry.partyId,
            ...(entry.data.transferPartyId ? [entry.data.transferPartyId] : []),
          ]);
          for (const partyId of affectedPartyIds) {
            void qc.invalidateQueries({
              queryKey: businessScopedQueryKey(getListLedgerEntriesQueryKey(partyId), activeBusinessId),
            });
            void qc.invalidateQueries({
              queryKey: businessScopedQueryKey(getGetPartyQueryKey(partyId), activeBusinessId),
            });
          }
          void qc.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey() });
          void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
          void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          void qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        });
        await drainPartyOperations(userId, activeBusinessId, stillCurrent, () => {
          if (activeScope.current === scope) {
            void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
          }
        }, 'deletes');
        })().catch(() => {});
    };
    const onRejected = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      toast.error('কাস্টমারের পরিবর্তন সিঙ্ক হয়নি', {
        description: detail?.message ?? 'কাস্টমারের তথ্য যাচাই করে আবার সেভ করুন।',
      });
    };
    setQueryPersistenceScope(userId, activeBusinessId ?? '');
    void restorePersistedQueries(qc, userId, activeBusinessId ?? '')
      .then(() => applyQueuedPartyOperations(qc, userId, activeBusinessId ?? ''))
      .catch(() => {});
    reconcile();
    window.addEventListener('online', reconcile);
    window.addEventListener(ENTRY_OUTBOX_CHANGED, reconcile);
    window.addEventListener(PARTY_OUTBOX_CHANGED, reconcile);
    window.addEventListener(PARTY_OUTBOX_REJECTED, onRejected);
    window.addEventListener('banglakhata-connection-restored', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    const interval = window.setInterval(reconcile, 15_000);
    return () => {
      activeScope.current = '';
      window.removeEventListener('online', reconcile);
      window.removeEventListener(ENTRY_OUTBOX_CHANGED, reconcile);
      window.removeEventListener(PARTY_OUTBOX_CHANGED, reconcile);
      window.removeEventListener(PARTY_OUTBOX_REJECTED, onRejected);
      window.removeEventListener('banglakhata-connection-restored', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      window.clearInterval(interval);
    };
  }, [scope, userId, activeBusinessId, qc]);
  useEffect(() => {
    if (!isAuthenticated) return;
    const heartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch('/api/auth/presence', { method: 'POST', credentials: 'include' })
        .catch(() => { /* Transient offline state is not active presence. */ });
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 60_000);
    document.addEventListener('visibilitychange', heartbeat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', heartbeat);
    };
  }, [isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || role !== 'owner') return;
    const handleOpenNotification = (event: Event) => {
      const detail = (event as CustomEvent<{
        notificationId?: string;
        businessId?: string;
        partyId?: string | null;
      }>).detail;
      if (!detail) return;
      if (detail.businessId && detail.businessId !== selectedBusinessId) {
        setSelectedBusiness(detail.businessId);
      }
      if (detail.notificationId) {
        markNotificationRead.mutate({ notificationId: detail.notificationId }, {
          onSuccess: () => {
            void qc.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
          },
        });
      }
      navigate(detail.partyId ? `/party/${detail.partyId}` : '/');
    };
    window.addEventListener(OPEN_NOTIFICATION_EVENT, handleOpenNotification);
    return () => window.removeEventListener(OPEN_NOTIFICATION_EVENT, handleOpenNotification);
  }, [isAuthenticated, role, selectedBusinessId, setSelectedBusiness, markNotificationRead.mutate, navigate, qc]);
  // Retry any bill image uploads that failed while offline, once connectivity
  // is restored. Only active when the user is authenticated (API calls need auth).
  useRetryPendingUploads(isAuthenticated);
  return null;
}

function NativePushRegistrationManager() {
  const { isAuthenticated, role, userId } = useAppAuth();
  const registerPushToken = useRegisterOwnerPushToken();
  const removePushToken = useRemoveOwnerPushToken();

  useEffect(() => {
    if (!isAuthenticated || role !== 'owner') return;
    const bridge = (window as Window & {
      ReactNativeWebView?: { postMessage: (message: string) => void };
    }).ReactNativeWebView;
    if (!bridge) return;

    const handleToken = (event: Event) => {
      const detail = (event as CustomEvent<{ token?: string; platform?: 'android' | 'ios' }>).detail;
      if (
        !detail ||
        typeof detail.token !== 'string' ||
        (detail.platform !== 'android' && detail.platform !== 'ios')
      ) return;

      registerPushToken.mutate(
        { data: { token: detail.token, platform: detail.platform } },
        {
          onSuccess: () => {
            localStorage.setItem(STORED_OWNER_PUSH_TOKEN_KEY, JSON.stringify({
              token: detail.token,
              platform: detail.platform,
            }));
            window.dispatchEvent(new CustomEvent(OWNER_PUSH_REGISTRATION_EVENT, {
              detail: { status: 'enabled' },
            }));
          },
          onError: () => {
            window.dispatchEvent(new CustomEvent(OWNER_PUSH_REGISTRATION_EVENT, {
              detail: { status: 'failed' },
            }));
          },
        },
      );
    };
    const handleNativeStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status !== 'not-enabled' && status !== 'permission-denied') return;

      const stored = localStorage.getItem(STORED_OWNER_PUSH_TOKEN_KEY);
      if (!stored) return;
      try {
        const tokenInput = JSON.parse(stored) as {
          token?: string;
          platform?: 'android' | 'ios';
        };
        if (
          typeof tokenInput.token !== 'string' ||
          (tokenInput.platform !== 'android' && tokenInput.platform !== 'ios')
        ) {
          localStorage.removeItem(STORED_OWNER_PUSH_TOKEN_KEY);
          return;
        }
        removePushToken.mutate(
          { data: { token: tokenInput.token, platform: tokenInput.platform } },
          { onSuccess: () => localStorage.removeItem(STORED_OWNER_PUSH_TOKEN_KEY) },
        );
      } catch {
        localStorage.removeItem(STORED_OWNER_PUSH_TOKEN_KEY);
      }
    };

    window.addEventListener(NATIVE_PUSH_TOKEN_EVENT, handleToken);
    window.addEventListener(NATIVE_PUSH_STATUS_EVENT, handleNativeStatus);
    const readyMessageTimer = window.setTimeout(() => {
      try {
        bridge.postMessage(JSON.stringify({ type: 'banglakhata-web-ready' }));
      } catch {
        // The dashboard remains usable if the native notification bridge is unavailable.
      }
    }, 0);
    return () => {
      window.clearTimeout(readyMessageTimer);
      window.removeEventListener(NATIVE_PUSH_TOKEN_EVENT, handleToken);
      window.removeEventListener(NATIVE_PUSH_STATUS_EVENT, handleNativeStatus);
    };
  }, [isAuthenticated, role, userId, registerPushToken.mutate, removePushToken.mutate]);

  return null;
}

// ─── Invalidate cache on user change ──────────────────────────────────────────

function AuthCacheInvalidator() {
  const qc = useQueryClient();
  const { selectedBusinessId, setSelectedBusiness, setBusinesses } = useBusinessContext();
  const { isLoaded, userId: clerkUserId } = useAuth();
  const previousAuthorization = useRef<{
    userId: string;
    role: string | undefined;
    adjustmentPartyIds: string[];
  } | null>(null);
  const { data: me, isError, error } = useQuery({
    queryKey: authMeQueryKey(clerkUserId),
    queryFn: () => fetchMe(),
    enabled: isLoaded,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  useEffect(() => {
    if (isError && [401, 403].includes((error as Error & { status?: number })?.status ?? 0)) {
      qc.clear();
      const cachedIdentity = readOfflineIdentity();
      clearOfflineIdentity();
      void clearPersistedQueries(cachedIdentity?.userId).catch(() => {});
      previousAuthorization.current = null;
      return;
    }
    if (isError) return; // A stale successful query is not fresh permission.
    if (!me?.userId || !me.businessId) return;
    const adjustmentPartyIds = (me as typeof me & { adjustmentPartyIds?: string[] }).adjustmentPartyIds ?? [];
    clearLocalLogoutPending();
    saveOfflineIdentity({ ...me, adjustmentPartyIds });
    setQueryPersistenceScope(me.userId, selectedBusinessId ?? me.businessId);
    const previous = previousAuthorization.current;
    if (previous && previous.userId !== me.userId) {
      qc.clear();
      void clearPersistedQueries(previous.userId).catch(() => {});
      clearOfflineIdentity();
      saveOfflineIdentity({ ...me, adjustmentPartyIds });
      clearAllPendingUploads();
      localStorage.removeItem('selected_business_id');
      setSelectedBusiness(me.businessId);
    } else if (previous && (previous.role !== me.role ||
      JSON.stringify(previous.adjustmentPartyIds) !== JSON.stringify(adjustmentPartyIds))) {
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth-me' });
    }
    previousAuthorization.current = { userId: me.userId, role: me.role, adjustmentPartyIds };
  }, [me, isError, error, qc, setSelectedBusiness]);

  useEffect(() => {
    if (!me?.userId || isError) return;
    let active = true;
    void fetch('/api/businesses', { credentials: 'include', cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const businesses = await response.json() as BusinessInfo[];
      if (active) {
        setBusinesses(businesses);
        const ids = businesses.map((business) => business.id);
        if (!selectedBusinessId || !ids.includes(selectedBusinessId)) {
          if (selectedBusinessId) {
            qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth-me' });
          }
          setSelectedBusiness(me.businessId);
        }
      }
    }).catch(() => { /* No new local business grants during an outage. */ });
    return () => { active = false; };
  }, [me, isError, selectedBusinessId, setSelectedBusiness, setBusinesses, qc]);

  return null;
}

// ─── Auth state (unified Clerk + phone) ───────────────────────────────────────

/**
 * Returns the combined auth state across Clerk (email/Google) and the custom
 * phone-OTP path. Phone auth is confirmed by a successful /api/auth/me fetch
 * (the server reads the httpOnly `phone_session` cookie).
 *
 * Online authentication and business permissions come from /api/auth/me.
 * When that service cannot be reached, a previously verified local identity
 * is used only to open cached data and queue local changes; a server 401/403
 * always disables that fallback.
 */
export function useAppAuth() {
  const { isLoaded, isSignedIn: clerkSignedIn, userId: clerkUserId } = useAuth();

  // Resolve the server-side role even in development; a Clerk session alone
  // does not establish the user's business permissions.
  const devBypass = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
  const enabled = isLoaded && !devBypass;
  const { data: authData, isLoading: authLoading, isError, error } = useQuery({
    queryKey: authMeQueryKey(clerkUserId),
    queryFn: () => fetchMe(),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  const status = (error as Error & { status?: number } | undefined)?.status;
  const storedIdentity = isLocalLogoutPending() ? null : readOfflineIdentity();
  const offlineIdentity = storedIdentity &&
    status !== 401 &&
    status !== 403 &&
    (isOfflineMode() || authLoading)
    ? storedIdentity
    : null;
  const resolvedAuthData = authData ?? offlineIdentity ?? undefined;

  // A previously authenticated local identity lets the already-cached app
  // open immediately while offline or while Clerk's CDN is unreachable. A
  // definitive 401/403 above always overrides it; server APIs remain the
  // authority whenever the device is connected.
  const authSettled = isLoaded && (!enabled || !authLoading || !!offlineIdentity);

  const networkFallback = !!offlineIdentity && status !== 401 && status !== 403;
  const realAuth = enabled && (
    (!isError && !!authData?.userId) ||
    (networkFallback && !!offlineIdentity.userId)
  );

  // Do not grant the offline fallback after an authoritative rejection.
  const isAuthenticated = authSettled ? realAuth : !!offlineIdentity;

  // Block rendering until auth has settled authoritatively
  const isLoading = !authSettled && !offlineIdentity;

  // Role info: NEVER default to 'owner'. Require the true role from /me.
  const role = resolvedAuthData?.role || "staff";

  // ── Development bypass — returned AFTER all hooks so hook order is stable ──
  if (devBypass) {
    return { isAuthenticated: true, isLoading: false, authMethod: 'dev' as const, role: 'owner' as const, userId: 'dev-user', businessId: null, needsBookName: false, adjustmentPartyIds: [] as string[] };
  }

  return {
    isAuthenticated,
    isLoading,
    authMethod: resolvedAuthData?.authMethod ?? (clerkSignedIn ? 'clerk' : null),
    role,
    userId: resolvedAuthData?.userId,
    businessId: resolvedAuthData?.businessId ?? null,
    needsBookName: resolvedAuthData?.needsBookName ?? false,
    adjustmentPartyIds: (resolvedAuthData as (typeof resolvedAuthData & { adjustmentPartyIds?: string[] }) | undefined)?.adjustmentPartyIds ?? [],
    authError: isError ? (error as Error).message : null,
  };
}

// ─── Branded splash (first-visit only) ───────────────────────────────────────

/**
 * Shown only on the very first visit (no cached auth) while Clerk loads.
 * Matches the landing-page hero so the transition feels like a natural
 * continuation rather than a loading artifact.
 */
function AppSplash() {
  return (
    <div className="h-[100dvh] w-full bg-gradient-to-b from-[#1B3A6B] to-[#2a5298] flex flex-col items-center justify-center">
      <img
        src={`${basePath}/logo-icon.svg`}
        alt="Banglakhata"
        className="w-20 h-20 mb-5 drop-shadow-xl"
      />
      <p className="text-white font-extrabold text-2xl tracking-tight">Banglakhata</p>
      <div className="mt-8 w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    </div>
  );
}

// ─── Protected wrapper ────────────────────────────────────────────────────────

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, role } = useAppAuth();
  const [location] = useLocation();

  if (isLoading) return <AppSplash />;

  if (!isAuthenticated) {
    return <Redirect to="/sign-in" />;
  }

  // Staff restricted routing
  if (role === 'staff') {
    const isAllowed = location === '/' || (location.startsWith('/party/') && location.split('/').length === 3);
    if (!isAllowed) {
      return <Redirect to="/" />;
    }
  }

  return <MainLayout>{children}</MainLayout>;
}

// ─── Owner Protected wrapper ──────────────────────────────────────────────────

function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, role } = useAppAuth();

  if (isLoading) return <AppSplash />;

  if (!isAuthenticated) {
    return <Redirect to="/sign-in" />;
  }

  if (role === 'staff') {
    return <Redirect to="/" />;
  }

  return <MainLayout>{children}</MainLayout>;
}

// ─── Home route (public landing or app) ──────────────────────────────────────

function HomeRoute() {
  const { isAuthenticated, isLoading, role } = useAppAuth();

  if (isLoading) return <AppSplash />;

  if (isAuthenticated) {
    if (role !== 'staff') return <Redirect to="/dashboard" />;
    return (
      <MainLayout>
        <HomeView />
      </MainLayout>
    );
  }

  return <LandingPage />;
}

function SignInRoute() {
  const { isAuthenticated, isLoading } = useAppAuth();

  if (isLoading) return <AppSplash />;
  if (isAuthenticated) return <Redirect to="/" />;
  return <SignInPage />;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function AuthServerReporter({ onNetworkFailure, onSettled }: { onNetworkFailure: () => void; onSettled: () => void }) {
  const { isLoaded, userId } = useAuth();
  const { data, isSuccess, isError, error } = useQuery({
    queryKey: authMeQueryKey(userId),
    queryFn: () => fetchMe(),
    enabled: isLoaded,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  useEffect(() => {
    if (!isLoaded) return;
    if (isSuccess) {
      if (data?.userId && data.businessId && (data.role === 'owner' || data.role === 'staff')) {
        markServerReauthenticated();
        onSettled();
      } else onNetworkFailure();
    }
    if (isError) {
      const status = (error as Error & { status?: number })?.status;
      if (status === 401 || status === 403) { revokeNetworkWrites(); onSettled(); }
      else onNetworkFailure();
    }
  }, [isLoaded, data, isSuccess, isError, error, onSettled, onNetworkFailure]);
  return null;
}

function AppRouter({ onNetworkFailure, onSettled }: { onNetworkFailure: () => void; onSettled: () => void }) {
  return (
    <>
      <AuthServerReporter onNetworkFailure={onNetworkFailure} onSettled={onSettled} />
      <LanguageProvider>
        <ConnectionStateProvider>
        <AuthCacheInvalidator />
        <RealtimeSyncManager />
        <NativePushRegistrationManager />
        <TooltipProvider>
          <Suspense fallback={<AppSplash />}>
            <Switch>
              {/* Public */}
              <Route path="/" component={HomeRoute} />
              <Route path="/privacy-policy" component={PrivacyPolicyPage} />
              <Route path="/support" component={SupportPage} />
              {/* REQUIRED — copy "/sign-in/*?" verbatim */}
              <Route path="/sign-in/*?" component={SignInRoute} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              {/* Protected */}
              <Route path="/dashboard">
                <OwnerLayout>
                  <HomeView />
                </OwnerLayout>
              </Route>
              <Route path="/access">
                <OwnerLayout>
                  <AccessPage />
                </OwnerLayout>
              </Route>
              <Route path="/party/:partyId/entry/:entryId">
                {() => (
                  <OwnerLayout>
                    <TransactionDetailPage />
                  </OwnerLayout>
                )}
              </Route>
              <Route path="/party/:id/report">
                {() => (
                  <OwnerLayout>
                    <PartyReportView />
                  </OwnerLayout>
                )}
              </Route>
              <Route path="/party/:id/profile">
                {() => (
                  <OwnerLayout>
                    <PartyProfileView />
                  </OwnerLayout>
                )}
              </Route>
              <Route path="/party/:id">
                {() => (
                  <ProtectedLayout>
                    <PartyView />
                  </ProtectedLayout>
                )}
              </Route>
              <Route path="/reports">
                <OwnerLayout>
                  <ReportView />
                </OwnerLayout>
              </Route>
              <Route path="/rejected-drafts">
                <OwnerLayout>
                  <RejectedDraftsPage />
                </OwnerLayout>
              </Route>
              <Route path="/staff-deployment">
                <OwnerLayout>
                  <StaffDeploymentPage />
                </OwnerLayout>
              </Route>
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </TooltipProvider>
        <Toaster position="bottom-right" richColors />
        <EntrySavedFeedbackHost />
        <BusinessSwitcherDrawer />
        </ConnectionStateProvider>
      </LanguageProvider>
    </>
  );
}

function AppClient() {
  const clearQueries = useCallback(() => queryClient.clear(), []);
  const { phase, goOffline, serverAuthSettled, retry } = useAuthConnectivity(clearQueries);
  const [location, setLocation] = useLocation();
  const cachedIdentity = isLocalLogoutPending() ? null : readOfflineIdentity();

  useEffect(() => {
    if (
      !cachedIdentity ||
      location === "/privacy-policy" ||
      location === "/support"
    ) return;
    setQueryPersistenceScope(cachedIdentity.userId, cachedIdentity.businessId);
    void restorePersistedQueries(queryClient, cachedIdentity.userId, cachedIdentity.businessId).catch(() => {});
  }, [cachedIdentity?.userId, cachedIdentity?.businessId, location]);

  // Legal and support pages must remain reachable without an auth session,
  // Clerk configuration, or a successful server connectivity probe.
  if (location === "/privacy-policy") return <PrivacyPolicyPage />;
  if (location === "/support") return <SupportPage />;

  if (!clerkPubKey) {
    return (
      <main className="min-h-[100dvh] bg-slate-50 px-6 flex items-center justify-center">
        <section role="alert" className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-sm border border-slate-100">
          <h1 className="text-xl font-bold text-slate-900">অ্যাপটি এখন খোলা যাচ্ছে না</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">সাইন-ইন কনফিগারেশন পাওয়া যায়নি। পরে আবার চেষ্টা করুন।</p>
        </section>
      </main>
    );
  }

  if (phase === 'offline' && !cachedIdentity) {
    return <OnlineConnectionRequired onRetry={() => { void retry(); }} />;
  }

  // Boot Clerk alongside the reachability probe, but keep authenticated routes,
  // realtime listeners, and mutation-capable providers behind the online gate.
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: { title: 'Welcome back', subtitle: 'Sign in to your ledger account' },
        },
        signUp: {
          start: { title: 'Create your account', subtitle: 'Start managing your business ledger' },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        {phase === 'probing' && !cachedIdentity
          ? <AppSplash />
          : <AppRouter onNetworkFailure={goOffline} onSettled={serverAuthSettled} />}
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <BusinessContextProvider>
      <WouterRouter base={basePath}>
        <AppClient />
      </WouterRouter>
    </BusinessContextProvider>
  );
}

function OnlineConnectionRequired({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="min-h-[100dvh] bg-slate-50 px-6 flex items-center justify-center">
      <section className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-sm border border-slate-100">
        <h1 className="text-xl font-bold text-slate-900">সার্ভারের সাথে সংযোগ নেই</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          ব্রাউজারে হিসাব দেখতে বা যোগ করতে সক্রিয় ইন্টারনেট সংযোগ দরকার। সংযোগ ফিরে এলে আবার চেষ্টা করুন।
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 min-h-11 w-full rounded-xl bg-[#0b3d91] px-4 font-semibold text-white hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          আবার চেষ্টা করুন
        </button>
      </section>
    </main>
  );
}

export default App;
