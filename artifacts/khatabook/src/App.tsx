import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { MainLayout } from '@/components/layout/main-layout';
import { HomeView } from '@/pages/home';
import { PartyView } from '@/pages/party-view';
import { ReportView } from '@/pages/report-view';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <MainLayout>
            <Switch>
              <Route path="/" component={HomeView} />
              <Route path="/party/:id" component={PartyView} />
              <Route path="/reports" component={ReportView} />
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
