import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMe } from './phoneAuth';

export type AuthConnectivity = 'probing' | 'online' | 'offline';
export const AUTH_PROBE_TIMEOUT_MS = 6000;
const CLERK_BOOT_TIMEOUT_MS = 8000;
let networkWritesAuthorized = false;
export function isNetworkWriteAuthorized() { return networkWritesAuthorized; }
export function markServerReauthenticated() { networkWritesAuthorized = true; }
export function revokeNetworkWrites() { networkWritesAuthorized = false; }

/**
 * Probe our own server before mounting Clerk or any mutating application UI.
 * navigator.onLine is advisory: captive portals and dead upstream connections
 * still report true. Without the server, browser ledger routes stay unavailable.
 */
export function useAuthConnectivity(clearQueries: () => void) {
  const [phase, setPhase] = useState<AuthConnectivity>(() => navigator.onLine ? 'probing' : 'offline');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const settled = useRef(false);
  const attempt = useRef(0);
  const activeProbe = useRef<AbortController | null>(null);

  const goOffline = useCallback(() => {
    revokeNetworkWrites();
    attempt.current++;
    activeProbe.current?.abort();
    activeProbe.current = null;
    settled.current = false;
    clearQueries();
    setPhase('offline');
  }, [clearQueries]);

  const probe = useCallback(async () => {
    if (!navigator.onLine) { goOffline(); return; }
    revokeNetworkWrites();
    const id = ++attempt.current;
    activeProbe.current?.abort();
    const controller = new AbortController();
    activeProbe.current = controller;
    const deadline = setTimeout(() => controller.abort(), AUTH_PROBE_TIMEOUT_MS);
    try {
      const me = await fetchMe(controller.signal);
      if (id !== attempt.current) return;
      if (!me.userId || !me.businessId || (me.role !== 'owner' && me.role !== 'staff')) throw new Error('Invalid identity response');
      settled.current = false;
      setPhase('online');
    } catch (error) {
      if (id !== attempt.current) return;
      const status = (error as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        revokeNetworkWrites();
        clearQueries();
        settled.current = false;
        setPhase('online'); // public landing / sign-in; never local offline ledger
      } else {
        goOffline();
      }
    } finally {
      clearTimeout(deadline);
      if (activeProbe.current === controller) activeProbe.current = null;
    }
  }, [clearQueries, goOffline]);

  useEffect(() => {
    if (navigator.onLine) void probe();
    const online = () => { void probe(); };
    window.addEventListener('online', online);
    window.addEventListener('offline', goOffline);
    const retry = window.setInterval(() => {
      if (navigator.onLine && phaseRef.current === 'offline') void probe();
    }, 10_000);
    const visible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && phaseRef.current === 'offline') void probe();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(retry);
      attempt.current++;
      activeProbe.current?.abort();
    };
  }, [probe, goOffline]);

  useEffect(() => {
    if (phase !== 'online' || settled.current) return;
    const timer = setTimeout(() => {
      if (!settled.current) goOffline(); // SDK/CDN or /me may be stalled
    }, CLERK_BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, goOffline]);

  const serverAuthSettled = useCallback(() => { settled.current = true; }, []);
  return { phase, goOffline, serverAuthSettled, retry: probe };
}