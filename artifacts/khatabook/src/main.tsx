import { createRoot } from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/app-error-boundary';
import { registerServiceWorker } from './lib/registerServiceWorker';
import { deferShellReloadDuringAuth } from './lib/serviceWorkerUpdate';

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
  // A shell update must not interrupt Clerk or phone OTP auth flows.
  if (deferShellReloadDuringAuth(window.location.pathname, message.version)) return;
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
