import { createRoot } from 'react-dom/client';

import App from './App';
import { registerServiceWorker } from './lib/registerServiceWorker';

import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
window.addEventListener('load', registerServiceWorker, { once: true });
