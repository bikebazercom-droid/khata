import { createRoot } from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/app-error-boundary';
import { registerServiceWorker } from './lib/registerServiceWorker';

import './index.css';

let reloadedShellVersion: string | null = null;
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data as { type?: unknown; version?: unknown } | null;
  if (
    message?.type !== 'banglakhata-shell-version' ||
    typeof message.version !== 'string' ||
    !message.version ||
    message.version === reloadedShellVersion
  ) return;
  reloadedShellVersion = message.version;
  if (/^\/(sign-in|sign-up)(?:\/|$)/.test(window.location.pathname)) {
    // A shell update must not interrupt Clerk's sign-in/OAuth callback flow.
    try {
      sessionStorage.setItem('banglakhata:pending-shell-reload', message.version);
    } catch {
      // Keeping the active auth flow uninterrupted is more important than
      // applying the shell update when browser storage is unavailable.
    }
    return;
  }
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
window.addEventListener('load', registerServiceWorker, { once: true });
// A first launch without connectivity cannot install the worker. Retry once a
// connection returns so subsequent launches can use the complete cached shell.
window.addEventListener('online', registerServiceWorker);
