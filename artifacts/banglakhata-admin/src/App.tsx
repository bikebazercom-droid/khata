import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { Component, useEffect, type ReactNode } from 'react';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import {
  ADMIN_AUTH_CHANGED_EVENT,
  clearAdminAuth,
  getAdminToken,
  getAdminTokenExpires,
  hasValidAdminSession,
} from '@/lib/auth';

// App imports
import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import UsersPage from '@/pages/users';
import UserDetailPage from '@/pages/user-detail';
import SettingsPage from '@/pages/settings';

// Generated admin API calls read the latest JWT before every request.
setAuthTokenGetter(getAdminToken);

function handleUnauthorized(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (status === 401 && getAdminToken()) clearAdminAuth();
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AdminSessionController() {
  const [, setLocation] = useLocation();
  const client = useQueryClient();

  useEffect(() => {
    let expiryTimer: number | undefined;

    const clearTimer = () => {
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    };

    const redirectToLogin = () => {
      client.clear();
      setLocation('/');
    };

    const scheduleExpiry = () => {
      clearTimer();
      const token = getAdminToken();
      const expiresAt = getAdminTokenExpires();
      if (!token && !expiresAt) return;

      const remaining = Date.parse(expiresAt ?? '') - Date.now();
      if (!hasValidAdminSession()) {
        clearAdminAuth(false);
        redirectToLogin();
        return;
      }

      expiryTimer = window.setTimeout(() => clearAdminAuth(), remaining);
    };

    const handleAuthChange = () => {
      scheduleExpiry();
      if (!hasValidAdminSession()) redirectToLogin();
    };

    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, handleAuthChange);
    window.addEventListener('storage', handleAuthChange);
    scheduleExpiry();

    return () => {
      clearTimer();
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, handleAuthChange);
      window.removeEventListener('storage', handleAuthChange);
    };
  }, [client, setLocation]);

  return null;
}

function AdminGuard({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const isAuthenticated = hasValidAdminSession();

  useEffect(() => {
    if (isAuthenticated) return;
    clearAdminAuth(false);
    client.clear();
    setLocation('/');
  }, [client, isAuthenticated, setLocation]);

  return isAuthenticated ? <>{children}</> : <div className="min-h-screen" aria-busy="true" />;
}

class SettingsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" className="min-h-screen bg-slate-50 p-8">
          <div className="mx-auto max-w-xl rounded-lg border bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold">Settings could not be loaded</h1>
            <p className="mt-2 text-sm text-slate-600">
              Your admin session is still active. Reload this page to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md border px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Reload Settings
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

function ProtectedDashboard() {
  return <AdminGuard><DashboardPage /></AdminGuard>;
}

function ProtectedUsers() {
  return <AdminGuard><UsersPage /></AdminGuard>;
}

function ProtectedUserDetail() {
  return <AdminGuard><UserDetailPage /></AdminGuard>;
}

function ProtectedSettings() {
  return (
    <AdminGuard>
      <SettingsErrorBoundary>
        <SettingsPage />
      </SettingsErrorBoundary>
    </AdminGuard>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/dashboard" component={ProtectedDashboard} />
      <Route path="/users" component={ProtectedUsers} />
      <Route path="/users/:id" component={ProtectedUserDetail} />
      <Route path="/settings" component={ProtectedSettings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AdminSessionController />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
