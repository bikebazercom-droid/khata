import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAuthMeQueryKey, useGetAuthMe, useLogoutPhoneOtp, type AuthMe } from '@workspace/api-client-react';
import { clearSavedAuthToken, getSavedAuthToken, saveAuthToken } from '@/lib/authStorage';
import { isUnauthorized } from '@/lib/domain';

type PhoneSession = { token: string };

type AuthContextValue = {
  ready: boolean;
  token: string | null;
  identity: AuthMe | undefined;
  identityLoading: boolean;
  identityError: unknown;
  storageError: string | null;
  acceptSession: (session: PhoneSession) => Promise<void>;
  signOut: () => Promise<unknown | null>;
  refreshIdentity: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const identityQuery = useGetAuthMe({
    query: {
      enabled: ready && (Platform.OS === 'web' || !!token),
      queryKey: getGetAuthMeQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });
  const logoutMutation = useLogoutPhoneOtp();

  useEffect(() => {
    let active = true;
    getSavedAuthToken()
      .then((savedToken) => {
        if (active) setToken(savedToken);
      })
      .catch(() => {
        if (active) setStorageError('নিরাপদ স্টোরেজ থেকে সাইন-ইন তথ্য পড়া যায়নি।');
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !token || !identityQuery.error || !isUnauthorized(identityQuery.error)) return;
    clearSavedAuthToken().catch(() => undefined);
    setToken(null);
  }, [identityQuery.error, token]);

  const acceptSession = useCallback(async (session: PhoneSession) => {
    if (Platform.OS !== 'web') {
      await saveAuthToken(session.token);
      setToken(session.token);
    }
    setStorageError(null);
    await queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    let requestError: unknown | null = null;
    try {
      await logoutMutation.mutateAsync();
    } catch (error) {
      requestError = error;
    } finally {
      try {
        await clearSavedAuthToken();
      } catch (error) {
        requestError = requestError ?? error;
      }
      setToken(null);
      queryClient.clear();
    }
    return requestError;
  }, [logoutMutation, queryClient]);

  const refreshIdentity = useCallback(async () => {
    await identityQuery.refetch();
  }, [identityQuery]);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    token,
    identity: identityQuery.data,
    identityLoading: !ready || ((Platform.OS === 'web' || !!token) && identityQuery.isLoading),
    identityError: identityQuery.error,
    storageError,
    acceptSession,
    signOut,
    refreshIdentity,
  }), [
    ready, token, identityQuery.data, identityQuery.isLoading, identityQuery.error,
    storageError, acceptSession, signOut, refreshIdentity,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}