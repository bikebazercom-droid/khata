import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { MainLayout } from '@/components/layout/main-layout';
import { DashboardView } from '@/pages/dashboard';
import { PartyView } from '@/pages/party-view';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <MainLayout>
            <Switch>
              <Route path="/" component={DashboardView} />
              <Route path="/party/:id" component={PartyView} />
              <Route component={NotFound} />
            </Switch>
          </MainLayout>
        </WouterRouter>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
