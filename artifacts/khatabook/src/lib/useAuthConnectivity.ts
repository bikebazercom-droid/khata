import { useCallback, useEffect, useRef, useState } from 'react';
import { phoneLogout } from './phoneAuth';
import { clearLocalLogoutPending, isLocalLogoutPending } from './offlineSession';

export type AuthConnectivity = 'probing' | 'online' | 'offline';
export const AUTH_PROBE_TIMEOUT_MS = 6000;
const CLERK_BOOT_TIMEOUT_MS = 8000;
let networkWritesAuthorized = false;
let offlineMode = false;
export function isNetworkWriteAuthorized() { return networkWritesAuthorized; }
export function isOfflineMode() { return offlineMode; }
export function markServerReauthenticated() { networkWritesAuthorized = true; offlineMode = false; }
export function revokeNetworkWrites() { networkWritesAuthorized = false; }

/**
 * Probe the API process before mounting Clerk or any mutating application UI.
 * Keep server reachability separate from session authentication: an expired or
 * misconfigured auth session must not be reported as a network outage.
 */
export function useAuthConnectivity(clearQueries: () => void) {
  const [phase, setPhase] = useState<AuthConnectivity>('probing');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const settled = useRef(false);
  const attempt = useRef(0);
  const activeProbe = useRef<AbortController | null>(null);

  const goOffline = useCallback(() => {
    revokeNetworkWrites();
    offlineMode = true;
    attempt.current++;
    activeProbe.current?.abort();
    activeProbe.current = null;
    settled.current = false;
    setPhase('offline');
  }, []);

  const probe = useCallback(async () => {
    revokeNetworkWrites();
    const id = ++attempt.current;
    activeProbe.current?.abort();
    const controller = new AbortController();
    activeProbe.current = controller;
    const deadline = setTimeout(() => controller.abort(), AUTH_PROBE_TIMEOUT_MS);
    try {
      if (isLocalLogoutPending()) {
        const logoutEvent = await fetch('/api/auth/logout-event', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!logoutEvent.ok && logoutEvent.status !== 401) {
          const error = new Error('The server could not finish the pending logout') as Error & { status: number };
          error.status = logoutEvent.status;
          throw error;
        }
        await phoneLogout();
        clearLocalLogoutPending();
      }
      const response = await fetch('/api/healthz', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error('The API server health check failed') as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      const health = await response.json() as { status?: unknown };
      if (health.status !== 'ok') throw new Error('Invalid API health response');
      if (id !== attempt.current) return;
      offlineMode = false;
      settled.current = false;
      setPhase('online');
    } catch (error) {
      if (id !== attempt.current) return;
      const status = (error as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        revokeNetworkWrites();
        offlineMode = false;
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
    // WebViews can report navigator.onLine=false while their HTTPS connection
    // is working. Let the authenticated server probe determine connectivity.
    void probe();
    const online = () => { void probe(); };
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    const retry = window.setInterval(() => {
      if (phaseRef.current === 'offline') void probe();
    }, 10_000);
    const visible = () => {
      if (document.visibilityState === 'visible' && phaseRef.current === 'offline') void probe();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
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