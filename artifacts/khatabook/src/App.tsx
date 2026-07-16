import { useEffect, useRef } from 'react';
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
import { TransactionDetailPage } from '@/pages/transaction-detail';
import { ReportView } from '@/pages/report-view';
import { LandingPage } from '@/pages/landing';
import { SignInPage } from '@/pages/sign-in';
import { SignUpPage } from '@/pages/sign-up';
import NotFound from '@/pages/not-found';
import { fetchMe } from '@/lib/phoneAuth';
import { useRealtimeSync } from '@/lib/useRealtimeSync';
import { useRetryPendingUploads } from '@/lib/useRetryPendingUploads';

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
      // Never auto-retry failed requests — SSE-driven invalidation handles
      // re-fetching when connectivity is restored.
      retry: false,
      // Data is considered fresh for 30 seconds. After that, a background
      // refetch is triggered on the next mount/focus/reconnect. SSE events
      // bypass staleTime entirely — they call invalidateQueries directly.
      staleTime: 30_000,
      // Refetch automatically when the user switches back to this tab
      // (catches the case where data changed on another device while this
      // tab was in the background and the SSE connection was throttled).
      refetchOnWindowFocus: true,
      // When the browser re-establishes a network connection, resume any
      // queries that were paused while offline and refetch stale data.
      refetchOnReconnect: true,
      // With `online` mode, queries are paused when the browser reports
      // no network and automatically resume (and refetch) once it returns.
      // This is the default but we declare it explicitly so the intent is
      // visible and won't be accidentally overridden.
      networkMode: 'online',
    },
  },
});

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
 */
function useAppAuth() {
  const { isLoaded, isSignedIn: clerkSignedIn } = useAuth();
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

  const isAuthenticated = clerkSignedIn || (enabled && !!phoneAuth?.userId);
  const isLoading = !isLoaded || (enabled && phoneLoading);

  return { isAuthenticated, isLoading, authMethod: clerkSignedIn ? 'clerk' : (phoneAuth ? 'phone' : null) };
}

// ─── Protected wrapper ────────────────────────────────────────────────────────

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAppAuth();

  if (isLoading) {
    return (
      <div className="h-[100dvh] w-full bg-slate-200/60 flex justify-center">
        <div className="w-full max-w-lg h-[100dvh] bg-[#f8fafc] flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/sign-in" />;
  }

  return <MainLayout>{children}</MainLayout>;
}

// ─── Home route (public landing or app) ──────────────────────────────────────

function HomeRoute() {
  const { isAuthenticated, isLoading } = useAppAuth();

  if (isLoading) {
    return (
      <div className="h-[100dvh] w-full bg-slate-200/60 flex justify-center">
        <div className="w-full max-w-lg h-[100dvh] bg-[#f8fafc] flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

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
            <Route component={NotFound} />
          </Switch>
        </TooltipProvider>
        <Toaster position="bottom-right" richColors />
        </ConnectionStateProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppRouter />
    </WouterRouter>
  );
}

export default App;
