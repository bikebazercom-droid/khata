import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { setAuthTokenGetter } from '@workspace/api-client-react';

// App imports
import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import UsersPage from '@/pages/users';
import UserDetailPage from '@/pages/user-detail';
import SettingsPage from '@/pages/settings';

// Wire the admin JWT into every generated API call.
// customFetch reads this getter before each request and attaches
// "Authorization: Bearer <token>" when a token is present.
setAuthTokenGetter(() => localStorage.getItem('admin_token'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/users/:id" component={UserDetailPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
