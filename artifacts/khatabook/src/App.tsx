import { useEffect, useRef, useState } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { MainLayout } from '@/components/layout/main-layout';
import { ConnectionStateProvider, useConnectionState } from '@/context/connection-state';
import { HomeView } from '@/pages/home';
import { PartyView } from '@/pages/party-view';
import { PartyProfileView } from '@/pages/party-profile';
import { TransactionDetailPage } from '@/pages/transaction-detail';
import { ReportView } from '@/pages/report-view';
import { StaffDeploymentPage } from '@/pages/staff-deployment';
import { LandingPage } from '@/pages/landing';
import { SignInPage } from '@/pages/sign-in';
import { SignUpPage } from '@/pages/sign-up';
import NotFound from '@/pages/not-found';
import { fetchMe } from '@/lib/phoneAuth';
import { useRealtimeSync } from '@/lib/useRealtimeSync';
import { useRetryPendingUploads } from '@/lib/useRetryPendingUploads';
import { readAuthCache, writeAuthCache, clearAuthCache } from '@/lib/authCache';
import { restoreCache, persistCache, clearPersistedCache } from '@/lib/queryPersister';
import { BusinessContextProvider } from '@/lib/businessContext';
import { BusinessSwitcherDrawer } from '@/components/modals/business-switcher-drawer';
import { LanguageProvider } from '@/lib/i18n';

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

// ── Seed the QueryClient with last-session data before the first render ───────
//
// restoreCache() reads the localStorage snapshot synchronously and calls
// queryClient.setQueryData() for every stored query key. This means the
// very first render of HomeView, PartyView, etc. already has data —
// no spinner, no blank screen, even when the network is slow or offline.
//
// persistCache() subscribes to the cache and writes each successful fetch
// to localStorage so the next session can restore from it.
restoreCache(queryClient);
persistCache(queryClient);

// ─── Real-time sync ───────────────────────────────────────────────────────────

/**
 * Mounts the SSE subscription only when the user is authenticated so we don't
 * attempt an un-authed connection on the landing page.
 * Must be rendered inside both ClerkProvider and QueryClientProvider.
 */
function RealtimeSyncManager() {
  const { isAuthenticated } = useAppAuth();
  const { setIsOnline } = useConnectionState();
  useRealtimeSync(isAuthenticated, setIsOnline);
  // Retry any bill image uploads that failed while offline, once connectivity
  // is restored. Only active when the user is authenticated (API calls need auth).
  useRetryPendingUploads(isAuthenticated);
  return null;
}

// ─── Invalidate cache on user change ──────────────────────────────────────────

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
        if (userId === null) {
          // User signed out — clear both the optimistic auth cache and the
          // persisted query cache so a different user signing in never sees
          // the previous session's data during the optimistic-render window.
          clearAuthCache();
          clearPersistedCache();
        }
      }
      prevUserIdRef.current = userId;
    });
    return unsub;
  }, [addListener, qc]);

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
function useAppAuth() {
  const { isLoaded, isSignedIn: clerkSignedIn } = useAuth();

  // Read once at mount — synchronous, ~0 ms, avoids any re-render on change.
  const [cachedAuth] = useState(() => readAuthCache());

  // Only call /me when Clerk says we're NOT signed in — avoids a redundant
  // round-trip for Clerk users.
  const enabled = isLoaded && !clerkSignedIn;
  const { data: phoneAuth, isLoading: phoneLoading } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchMe,
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  // Whether we have a definitive answer from both auth paths.
  const authSettled = isLoaded && (!enabled || !phoneLoading);

  const realAuth = clerkSignedIn || (enabled && !!phoneAuth?.userId);

  // If settled, use the real answer. If still loading but we have a cache
  // hit, optimistically report authenticated so the UI renders immediately.
  const isAuthenticated = authSettled ? realAuth : (cachedAuth !== null);

  // Only block with a loading state if we have no cache and haven't settled.
  const isLoading = !authSettled && cachedAuth === null;

  // Persist / clear the cache whenever auth settles.
  useEffect(() => {
    if (!authSettled) return;
    if (realAuth) {
      writeAuthCache(clerkSignedIn ? 'clerk' : 'phone');
    } else {
      // Session expired or user logged out — evict the optimistic cache.
      clearAuthCache();
    }
  }, [authSettled, realAuth, clerkSignedIn]);

  return { isAuthenticated, isLoading, authMethod: clerkSignedIn ? 'clerk' : (phoneAuth ? 'phone' : null) };
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
  const { isAuthenticated, isLoading } = useAppAuth();

  if (isLoading) return <AppSplash />;

  if (!isAuthenticated) {
    return <Redirect to="/sign-in" />;
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
        <ClerkCacheInvalidator />
        <RealtimeSyncManager />
        <TooltipProvider>
          <Switch>
            {/* Public */}
            <Route path="/" component={HomeRoute} />
            {/* REQUIRED — copy "/sign-in/*?" verbatim */}
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            {/* Protected */}
            <Route path="/party/:partyId/entry/:entryId">
              {() => (
                <ProtectedLayout>
                  <TransactionDetailPage />
                </ProtectedLayout>
              )}
            </Route>
            <Route path="/party/:id/profile">
              {() => (
                <ProtectedLayout>
                  <PartyProfileView />
                </ProtectedLayout>
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
              <ProtectedLayout>
                <ReportView />
              </ProtectedLayout>
            </Route>
            <Route path="/staff-deployment">
              <ProtectedLayout>
                <StaffDeploymentPage />
              </ProtectedLayout>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
        <Toaster position="bottom-right" richColors />
        <BusinessSwitcherDrawer />
        </ConnectionStateProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <BusinessContextProvider>
      <WouterRouter base={basePath}>
        <AppRouter />
      </WouterRouter>
    </BusinessContextProvider>
  );
}

export default App;
