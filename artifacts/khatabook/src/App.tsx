import { useEffect, useRef, useState } from 'react';
import { ClerkProvider, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { MainLayout } from '@/components/layout/main-layout';
import { ConnectionStateProvider, useConnectionState } from '@/context/connection-state';
import { HomeView } from '@/pages/home';
import { PartyView } from '@/pages/party-view';
import { PartyProfileView } from '@/pages/party-profile';
import { TransactionDetailPage } from '@/pages/transaction-detail';
import { ReportView } from '@/pages/report-view';
import { PartyReportView } from '@/pages/party-report-view';
import { StaffDeploymentPage } from '@/pages/staff-deployment';
import { AccessPage } from '@/pages/access';
import { LandingPage } from '@/pages/landing';
import { SignInPage } from '@/pages/sign-in';
import { SignUpPage } from '@/pages/sign-up';
import NotFound from '@/pages/not-found';
import { fetchMe } from '@/lib/phoneAuth';
import { useRealtimeSync } from '@/lib/useRealtimeSync';
import { useRetryPendingUploads } from '@/lib/useRetryPendingUploads';
import { readOfflineIdentity, writeOfflineIdentity, clearOfflineIdentity, allowOfflineBusinesses } from '@/lib/authCache';
import { setPersistedScope, persistCache, pausePersistedCache, clearActorViews } from '@/lib/queryPersister';
import { OfflineLedger } from '@/pages/offline-ledger';
import { BusinessContextProvider } from '@/lib/businessContext';
import { BusinessSwitcherDrawer } from '@/components/modals/business-switcher-drawer';
import { LanguageProvider } from '@/lib/i18n';
import { drainEntries, ENTRY_OUTBOX_CHANGED } from '@/lib/entryOutbox';
import { useBusinessContext } from '@/lib/businessContext';

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

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
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
      // ── Offline-first configuration ──────────────────────────────────────
      //
      // networkMode: 'offlineFirst' — queries fire regardless of what the
      // browser's navigator.onLine reports. When the network is genuinely
      // unreachable the query will fail as normal, but the persisted cache
      // (restored synchronously before first render) means the UI shows
      // real data rather than an empty/loading state. Background refetches
      // are paused while offline and resume the moment connectivity returns.
      networkMode: 'offlineFirst',
      //
      // staleTime: 5 min — reduces unnecessary background refetches on
      // every tab switch or component mount. SSE-driven invalidateQueries
      // already handles cross-device updates instantly; the staleTime is
      // just a ceiling on "how long can data stay fresh without SSE".
      staleTime: 5 * 60 * 1000,
      //
      // gcTime: 24 h — keeps query results in the in-memory cache overnight.
      // The queryPersister also writes to localStorage (24 h TTL), so both
      // layers stay aligned.
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

// ── Seed the QueryClient with last-session data before the first render ───────
// (Removed persisted query restore to prevent cross-account cache leak)

// ─── Real-time sync ───────────────────────────────────────────────────────────

/**
 * Mounts the SSE subscription only when the user is authenticated so we don't
 * attempt an un-authed connection on the landing page.
 * Must be rendered inside both ClerkProvider and QueryClientProvider.
 */
function RealtimeSyncManager() {
  const { isAuthenticated, userId } = useAppAuth();
  const { selectedBusinessId } = useBusinessContext();
  const { setIsOnline } = useConnectionState();
  useRealtimeSync(isAuthenticated, setIsOnline);
  const qc = useQueryClient();
  const activeScope = useRef('');
  const scope = isAuthenticated && userId ? JSON.stringify([userId, selectedBusinessId]) : '';
  activeScope.current = scope;
  useEffect(() => {
    if (!scope || !userId) return;
    const run = () => {
      void drainEntries(userId, selectedBusinessId, () => activeScope.current === scope, () => {
        if (activeScope.current === scope) void qc.invalidateQueries();
      }).catch(() => {
        toast.error('অফলাইন খসড়া পড়া যাচ্ছে না', { description: 'স্টোরেজ অনুমতি পরীক্ষা করুন; পরে আবার সিঙ্ক হবে।' });
      });
    };
    run();
    window.addEventListener('online', run);
    window.addEventListener(ENTRY_OUTBOX_CHANGED, run);
    window.addEventListener('banglakhata-connection-restored', run);
    document.addEventListener('visibilitychange', run);
    const interval = window.setInterval(run, 15_000);
    return () => {
      window.removeEventListener('online', run);
      window.removeEventListener(ENTRY_OUTBOX_CHANGED, run);
      window.removeEventListener('banglakhata-connection-restored', run);
      document.removeEventListener('visibilitychange', run);
      window.clearInterval(interval);
    };
  }, [scope, userId, selectedBusinessId, qc]);
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
  // Retry any bill image uploads that failed while offline, once connectivity
  // is restored. Only active when the user is authenticated (API calls need auth).
  useRetryPendingUploads(isAuthenticated);
  return null;
}

// ─── Invalidate cache on user change ──────────────────────────────────────────

function AuthCacheInvalidator() {
  const qc = useQueryClient();
  const { selectedBusinessId, setSelectedBusiness } = useBusinessContext();
  const { isLoaded, userId: clerkUserId } = useAuth();
  const { data: me, isError, error } = useQuery({
    queryKey: ['auth-me', clerkUserId],
    queryFn: fetchMe,
    enabled: isLoaded,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  useEffect(() => {
    if (isError && [401, 403].includes((error as Error & { status?: number })?.status ?? 0)) {
      qc.clear();
      const actor = readOfflineIdentity()?.userId;
      if (actor) clearActorViews(actor);
      clearOfflineIdentity();
      return;
    }
    if (!me?.userId || !me.businessId) return;
    const previous = readOfflineIdentity();
    if (previous && previous.userId === me.userId &&
      (previous.role !== me.role || JSON.stringify(previous.adjustmentPartyIds) !== JSON.stringify((me as typeof me & { adjustmentPartyIds?: string[] }).adjustmentPartyIds ?? []))) {
      clearActorViews(me.userId);
    }
    if (previous && previous.userId !== me.userId) {
      qc.clear();
      clearActorViews(previous.userId);
      clearOfflineIdentity();
      localStorage.removeItem('selected_business_id');
      setSelectedBusiness(me.businessId);
    }
    writeOfflineIdentity(me);
    const identity = readOfflineIdentity();
    const business = previous?.userId !== me.userId ? me.businessId : selectedBusinessId || me.businessId;
    if (identity?.permittedBusinessIds.includes(business)) {
      setPersistedScope(qc, me.userId, me.role ?? 'staff', business);
    } else {
      qc.clear();
      pausePersistedCache();
    }
  }, [me, selectedBusinessId, isError, error, qc, setSelectedBusiness]);

  useEffect(() => {
    if (!me?.userId || isError) return;
    let active = true;
    void fetch('/api/businesses', { credentials: 'include' }).then(async (response) => {
      if (!response.ok) return;
      const businesses = await response.json() as { id: string }[];
      if (active && readOfflineIdentity()?.userId === me.userId) {
        const ids = businesses.map((business) => business.id);
        allowOfflineBusinesses(me.userId, ids);
        if (selectedBusinessId && !ids.includes(selectedBusinessId)) {
          clearActorViews(me.userId);
          setSelectedBusiness(me.businessId);
        } else if (selectedBusinessId && ids.includes(selectedBusinessId)) {
          setPersistedScope(qc, me.userId, me.role ?? 'staff', selectedBusinessId);
        }
      }
    }).catch(() => { /* No new local business grants during an outage. */ });
    return () => { active = false; };
  }, [me, isError, selectedBusinessId, setSelectedBusiness, qc]);

  return null;
}

// ─── Auth state (unified Clerk + phone) ───────────────────────────────────────

/**
 * Returns the combined auth state across Clerk (email/Google) and the custom
 * phone-OTP path. Phone auth is confirmed by a successful /api/auth/me fetch
 * (the server reads the httpOnly `phone_session` cookie).
 *
 * Optimistic loading: if a previous session was cached in localStorage we
 * treat the user as authenticated immediately, skipping the spinner entirely.
 * The real check still runs in the background — if it fails (session expired),
 * we clear the cache and redirect to sign-in seamlessly.
 */
export function useAppAuth() {
  const { isLoaded, isSignedIn: clerkSignedIn, userId: clerkUserId } = useAuth();

  // Resolve the server-side role even in development; a Clerk session alone
  // does not establish the user's business permissions.
  const devBypass = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
  const enabled = isLoaded && !devBypass;
  const { data: authData, isLoading: authLoading, isError, error } = useQuery({
    queryKey: ['auth-me', clerkUserId],
    queryFn: fetchMe,
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });

  // Whether we have a definitive answer from auth paths.
  // We need authData to settle for the role.
  const authSettled = isLoaded && (!enabled || !authLoading);

  const realAuth = enabled && !isError && !!authData?.userId;

  // We MUST gate rendering on authoritative /auth/me to avoid cross-account leak
  const isAuthenticated = authSettled ? realAuth : false;

  // Block rendering until auth has settled authoritatively
  const isLoading = !authSettled;

  // Role info: NEVER default to 'owner'. Require the true role from /me.
  const role = authData?.role || "staff";

  // ── Development bypass — returned AFTER all hooks so hook order is stable ──
  if (devBypass) {
    return { isAuthenticated: true, isLoading: false, authMethod: 'dev' as const, role: 'owner' as const, userId: 'dev-user', adjustmentPartyIds: [] as string[] };
  }

  return {
    isAuthenticated,
    isLoading,
    authMethod: clerkSignedIn ? 'clerk' : (authData ? 'phone' : null),
    role,
    userId: authData?.userId,
    adjustmentPartyIds: (authData as (typeof authData & { adjustmentPartyIds?: string[] }) | undefined)?.adjustmentPartyIds ?? [],
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
  const { isAuthenticated, isLoading } = useAppAuth();

  if (isLoading) return <AppSplash />;

  if (isAuthenticated) {
    return (
      <MainLayout>
        <HomeView />
      </MainLayout>
    );
  }

  return <LandingPage />;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function AppRouter() {
  const [, setLocation] = useLocation();

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
        <LanguageProvider>
        <ConnectionStateProvider>
        <AuthCacheInvalidator />
        <RealtimeSyncManager />
        <TooltipProvider>
          <Switch>
            {/* Public */}
            <Route path="/" component={HomeRoute} />
            {/* REQUIRED — copy "/sign-in/*?" verbatim */}
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            {/* Protected */}
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
              {(params) => (
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
            <Route path="/staff-deployment">
              <OwnerLayout>
                <StaffDeploymentPage />
              </OwnerLayout>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
        <Toaster position="bottom-right" richColors />
        <OfflineReadyIndicator />
        <BusinessSwitcherDrawer />
        </ConnectionStateProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function OfflineReadyIndicator() {
  const [ready, setReady] = useState(false);
  const { isAuthenticated } = useAppAuth();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let active = true;
    void navigator.serviceWorker.ready.then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  return ready && isAuthenticated && readOfflineIdentity() ? <span className="fixed bottom-2 left-2 z-10 rounded-full bg-slate-800/90 px-2 py-1 text-xs text-white" aria-label="অফলাইন দেখার জন্য প্রস্তুত">অফলাইনে দেখার জন্য প্রস্তুত</span> : null;
}

function App() {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const goOffline = () => { pausePersistedCache(); queryClient.clear(); setOffline(true); };
    const goOnline = () => { queryClient.clear(); setOffline(false); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
  }, []);
  if (offline) {
    const identity = readOfflineIdentity();
    const selected = localStorage.getItem('selected_business_id');
    return <OfflineLedger identity={identity} businessId={selected || identity?.businessId || null} />;
  }
  return (
    <BusinessContextProvider>
      <WouterRouter base={basePath}>
        <AppRouter />
      </WouterRouter>
    </BusinessContextProvider>
  );
}

export default App;
