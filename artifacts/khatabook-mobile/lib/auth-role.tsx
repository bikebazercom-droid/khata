import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  const currentAuthKey = userId ? `clerk:${userId}` : isSignedIn ? 'clerk-session' : 'phone-session';

  useEffect(() => {
    requestIdentityRefresh = () => setRefreshSequence((current) => current + 1);
    return () => {
      requestIdentityRefresh = null;
    };
  }, []);

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const clerkToken = await getToken();
        if (clerkToken) return clerkToken;
      } catch {
        // Phone OTP sessions use the same shared API auth transport.
      }
      try {
        return await SecureStore.getItemAsync('phone_session_token');
      } catch {
        return null;
      }
    });
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    const status = (event.query.state.error as { status?: number } | null)?.status;
    if (status !== 401) return;
    queryClient.clear();
    setIdentity(null);
    setIdentityAuthKey(null);
    setUnauthorized(true);
    setError('Your session has expired. Please sign in again.');
    setLoading(false);
    void SecureStore.deleteItemAsync('phone_session_token').catch(() => {});
  }), [queryClient]);

  useEffect(() => {
    let cancelled = false;
    if (!isLoaded) return;

    setIdentity(null);
    setIdentityAuthKey(null);
    setError(null);
    setUnauthorized(false);
    setLoading(true);
    // Never allow queries from the previous authenticated account to remain
    // available while the new account's permissions are being resolved.
    queryClient.clear();

    async function loadIdentity() {
      try {
        const result = await customFetch<Partial<MobileIdentity>>('/api/auth/me', { responseType: 'json' });
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
          setIdentity({ ...result, adjustmentPartyIds: result.adjustmentPartyIds ?? [] } as MobileIdentity);
          setIdentityAuthKey(currentAuthKey);
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
          setError(cause instanceof Error ? cause.message : 'Could not load account permissions.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadIdentity();
    return () => {
      cancelled = true;
    };
  }, [currentAuthKey, getToken, isLoaded, isSignedIn, userId, queryClient, refreshSequence]);

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