import { createRoot } from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/app-error-boundary';
import { registerServiceWorker } from './lib/registerServiceWorker';
import { handleShellVersionMessage } from './lib/serviceWorkerUpdate';

import './index.css';

let reloadedShellVersion: string | null = null;
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<unknown>) => {
  const version = handleShellVersionMessage(
    event.data,
    window.location.pathname,
    reloadedShellVersion,
    () => window.location.reload(),
  );
  if (version) reloadedShellVersion = version;
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
