export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .catch(() => { /* Offline support unavailable in this browser. */ });
}