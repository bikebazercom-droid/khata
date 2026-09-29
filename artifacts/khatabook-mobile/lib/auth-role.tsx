import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@clerk/expo';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { customFetch } from '@/lib/api-transport';

export interface MobileIdentity {
  role: 'owner' | 'staff';
  userId: string;
  businessId: string;
  businessName: string;
  adjustmentPartyIds: string[];
}

interface AuthRoleContextValue {
  identity: MobileIdentity | null;
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
}

const AuthRoleContext = createContext<AuthRoleContextValue>({
  identity: null,
  loading: true,
  error: null,
  unauthorized: false,
});
let requestIdentityRefresh: (() => void) | null = null;

function getClerkTokenWithTimeout(
  getToken: () => Promise<string | null>,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      void getToken().then(
        (token) => {
          clearTimeout(timer);
          resolve(token);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
      );
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export function notifyMobileIdentityChanged() {
  requestIdentityRefresh?.();
}

export function AuthRoleProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<MobileIdentity | null>(null);
  const [identityAuthKey, setIdentityAuthKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const loadedAuthKey = useRef<string | null>(null);
  const lastRefresh = useRef(0);
  const currentAuthKey = userId ? `clerk:${userId}` : isSignedIn ? 'clerk-session' : 'phone-session';

  useEffect(() => {
    if (!identity || identityAuthKey !== currentAuthKey || unauthorized) return;
    const heartbeat = () => {
      if (AppState.currentState !== 'active') return;
      void customFetch('/api/auth/presence', {
        method: 'POST', responseType: 'text', headers: { 'X-Client-Platform': 'mobile' },
      }).catch(() => { /* Offline is not foreground presence on the server. */ });
    };
    heartbeat();
    const timer = setInterval(heartbeat, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') heartbeat();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [identity, identityAuthKey, currentAuthKey, unauthorized]);

  useEffect(() => {
    requestIdentityRefresh = () => {
      if (Date.now() - lastRefresh.current < 2_000) return;
      lastRefresh.current = Date.now();
      setRefreshSequence((current) => current + 1);
    };
    return () => {
      requestIdentityRefresh = null;
    };
  }, []);

  // An owner may change grants while this device stays on the same screen.
  useEffect(() => {
    if (!identity || identityAuthKey !== currentAuthKey || unauthorized) return;
    const refresh = () => {
      if (AppState.currentState === 'active') notifyMobileIdentityChanged();
    };
    const timer = setInterval(refresh, 10_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') notifyMobileIdentityChanged();
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [identity, identityAuthKey, currentAuthKey, unauthorized]);

  useEffect(() => queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    const status = (event.mutation.state.error as { status?: number } | null)?.status;
    if (status === 401 || status === 403) notifyMobileIdentityChanged();
  }), [queryClient]);

  useEffect(() => {
    setAuthTokenGetter(async () => {
      if (isSignedIn) {
        const clerkToken = await getClerkTokenWithTimeout(getToken, 3_000);
        if (clerkToken) return clerkToken;
      }
      try {
        return await SecureStore.getItemAsync('phone_session_token');
      } catch {
        return null;
      }
    });
    return () => setAuthTokenGetter(null);
  }, [getToken, isSignedIn]);

  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    const status = (event.query.state.error as { status?: number } | null)?.status;
    if (status === 403) { notifyMobileIdentityChanged(); return; }
    if (status !== 401) return;
    queryClient.clear();
    const accountChanged = loadedAuthKey.current !== currentAuthKey;
    if (accountChanged) {
      setIdentity(null);
      setIdentityAuthKey(null);
      setLoading(true);
      queryClient.clear();
    }
    setUnauthorized(true);
    setError('Your session has expired. Please sign in again.');
    setLoading(false);
    void SecureStore.deleteItemAsync('phone_session_token').catch(() => {});
  }), [queryClient]);

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded) return;
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), 15_000);

    setIdentity(null);
    setIdentityAuthKey(null);
    setError(null);
    setUnauthorized(false);
    // Never allow queries from the previous authenticated account to remain
    // available while the new account's permissions are being resolved.

    async function loadIdentity() {
      try {
        const result = await customFetch<Partial<MobileIdentity>>('/api/auth/me', {
          responseType: 'json',
          headers: { 'X-Client-Platform': 'mobile' },
          signal: controller.signal,
        });
        if (
          (result.role !== 'owner' && result.role !== 'staff') ||
          !result.userId ||
          !result.businessId ||
          typeof result.businessName !== 'string'
        ) {
          throw new Error('Account permissions response is incomplete.');
        }
        if (result.adjustmentPartyIds !== undefined &&
          (!Array.isArray(result.adjustmentPartyIds) ||
            !result.adjustmentPartyIds.every((id) => typeof id === 'string'))) {
          throw new Error('অ্যাকাউন্টের অ্যাডজাস্টমেন্ট অনুমতির তথ্য সঠিক নয়।');
        }
        if (!cancelled) {
          loadedAuthKey.current = currentAuthKey;
          setIdentity({ ...result, adjustmentPartyIds: result.adjustmentPartyIds ?? [] } as MobileIdentity);
          setIdentityAuthKey(currentAuthKey);
          // Assignment revocation must also remove stale party/ledger results.
          void queryClient.invalidateQueries();
        }
      } catch (cause) {
        if (!cancelled) {
          setIdentity(null);
          const status = (cause as { status?: number } | null)?.status;
          const isUnauthorized = status === 401;
          setUnauthorized(isUnauthorized);
          if (isUnauthorized) {
            void SecureStore.deleteItemAsync('phone_session_token').catch(() => {});
          }
          setError(controller.signal.aborted
            ? 'অ্যাকাউন্ট যাচাই করতে সময় বেশি লাগছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'
            : cause instanceof Error ? cause.message : 'অ্যাকাউন্টের অনুমতি যাচাই করা যায়নি।');
        }
      } finally {
        clearTimeout(requestTimeout);
        if (!cancelled) setLoading(false);
      }
    }

    void loadIdentity();
    return () => {
      cancelled = true;
      clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [currentAuthKey, isLoaded, isSignedIn, userId, queryClient, refreshSequence]);

  const visibleIdentity = identityAuthKey === currentAuthKey ? identity : null;
  const visibleLoading = loading || (!error && identityAuthKey !== currentAuthKey);
  const value = useMemo(
    () => ({ identity: visibleIdentity, loading: visibleLoading, error, unauthorized }),
    [visibleIdentity, visibleLoading, error, unauthorized],
  );
  return <AuthRoleContext.Provider value={value}>{children}</AuthRoleContext.Provider>;
}

export function useAuthRole() {
  return useContext(AuthRoleContext);
}