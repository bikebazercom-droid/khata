import { createRoot } from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/app-error-boundary';
import { registerServiceWorker } from './lib/registerServiceWorker';

import './index.css';

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
window.addEventListener('load', registerServiceWorker, { once: true });
// A first launch without connectivity cannot install the worker. Retry once a
// connection returns so subsequent launches can use the complete cached shell.
window.addEventListener('online', registerServiceWorker);
