import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { AppErrorBoundary } from './components/app-error-boundary';

import './index.css';

const App = lazy(() => import('./App'));

window.addEventListener('error', (event) => {
  console.error('[BanglaKhata Admin] Uncaught browser error', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[BanglaKhata Admin] Unhandled promise rejection', event.reason);
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error('[BanglaKhata Admin] Required #root mount element was not found');
  const fallback = document.createElement('main');
  fallback.setAttribute('role', 'alert');
  fallback.className = 'flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900';
  fallback.textContent = 'Admin panel could not start. Reload this page to try again.';
  document.body.replaceChildren(fallback);
} else {
  createRoot(rootElement).render(
    <AppErrorBoundary>
      <Suspense
        fallback={
          <main role="status" className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-600">
            Loading admin panel…
          </main>
        }
      >
        <App />
      </Suspense>
    </AppErrorBoundary>,
  );
}
