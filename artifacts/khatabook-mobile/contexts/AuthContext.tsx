import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAuthMeQueryKey,
  logoutPhoneOtp,
  reportAuthLogoutEvent,
  setAuthTokenGetter,
  useGetAuthMe,
  type AuthMe,
} from '@workspace/api-client-react';
import { clearSavedAuthToken, getSavedAuthToken, saveAuthToken } from '@/lib/authStorage';
import { isUnauthorized } from '@/lib/domain';

type PhoneSession = { token: string };
type AuthMethod = 'firebase' | 'phone';

const DELETED_ACCOUNT_MARKER = 'banglakhata.deleted-account-lockout';

type AuthContextValue = {
  ready: boolean;
  hasSession: boolean;
  accountDeleted: boolean;
  token: string | null;
  authMethod: AuthMethod | null;
  identity: AuthMe | undefined;
  identityLoading: boolean;
  identityError: unknown;
  storageError: string | null;
  getApiToken: () => Promise<string | null>;
  acceptSession: (session: PhoneSession) => Promise<void>;
  signOut: () => Promise<unknown | null>;
  clearAfterAccountDeletion: () => Promise<unknown | null>;
  clearNativeSession: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const queryClient = useQueryClient();
  const [storageReady, setStorageReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [preferredMethod, setPreferredMethod] = useState<AuthMethod | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const ready = storageReady;
  const identityQuery = useGetAuthMe({
    query: {
      enabled: ready && !accountDeleted && (Platform.OS === 'web' || !!token),
      queryKey: getGetAuthMeQueryKey(),
      retry: false,
      staleTime: 60_000,
    },
  });
  const authMethod = useMemo<AuthMethod | null>(() => {
    if (accountDeleted) return null;
    if (preferredMethod === 'phone' && (token || identityQuery.data?.authMethod === 'phone')) return 'phone';
    if (token && Platform.OS !== 'web') return 'phone';
    if (Platform.OS === 'web' && identityQuery.data?.authMethod) return identityQuery.data.authMethod;
    return null;
  }, [
    accountDeleted, preferredMethod, token, identityQuery.data?.authMethod,
  ]);
  const hasSession = authMethod !== null;
  const getApiToken = useCallback(async () => {
    if (Platform.OS === 'web' || accountDeleted) return null;
    if (authMethod === 'phone') return token ?? getSavedAuthToken();
    return null;
  }, [accountDeleted, authMethod, token]);

  useEffect(() => {
    let active = true;
    const tokenRead = Platform.OS === 'web' ? Promise.resolve(null) : getSavedAuthToken();
    Promise.all([tokenRead, AsyncStorage.getItem(DELETED_ACCOUNT_MARKER)])
      .then(([savedToken, deletedMarker]) => {
        if (!active) return;
        setToken(savedToken);
        setAccountDeleted(deletedMarker === '1');
      })
      .catch(() => {
        if (active) {
          setToken(null);
          setAccountDeleted(true);
          setStorageError('নিরাপদ স্টোরেজ থেকে সাইন-ইন তথ্য পড়া যায়নি।');
        }
      })
      .finally(() => {
        if (active) setStorageReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setAuthTokenGetter(null);
      return () => setAuthTokenGetter(null);
    }
    setAuthTokenGetter(getApiToken);
    return () => setAuthTokenGetter(getSavedAuthToken);
  }, [getApiToken]);

  useEffect(() => {
    if (!identityQuery.error || !isUnauthorized(identityQuery.error) || accountDeleted) return;
    if (authMethod !== 'phone' || Platform.OS === 'web') return;
    clearSavedAuthToken()
      .catch(() => undefined)
      .finally(() => {
        setToken(null);
        setPreferredMethod(null);
      });
  }, [accountDeleted, authMethod, identityQuery.error]);

  const acceptSession = useCallback(async (session: PhoneSession) => {
    if (Platform.OS !== 'web') {
      await saveAuthToken(session.token);
    }
    await AsyncStorage.removeItem(DELETED_ACCOUNT_MARKER);
    setAccountDeleted(false);
    setPreferredMethod('phone');
    setToken(Platform.OS === 'web' ? null : session.token);
    setStorageError(null);
    await queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
  }, [queryClient]);

  const signOut = useCallback(async (): Promise<unknown | null> => {
    let requestError: unknown | null = null;
    let phoneToken = token;
    if (Platform.OS !== 'web' && !phoneToken) {
      try {
        phoneToken = await getSavedAuthToken();
      } catch (error) {
        requestError = error;
      }
    }

    const phoneSessionPresent = Platform.OS === 'web' || !!phoneToken;
    let phoneRevoked = !phoneSessionPresent;

    if (phoneSessionPresent) {
      try {
        if (Platform.OS === 'web') {
          await logoutPhoneOtp();
        } else if (phoneToken) {
          await logoutPhoneOtp({ headers: { Authorization: `Bearer ${phoneToken}` } });
        } else {
          throw new Error('The phone session token is unavailable.');
        }
        phoneRevoked = true;
      } catch (error) {
        requestError = requestError ?? error;
      }
    }

    if (phoneRevoked && phoneToken) {
      try {
        await clearSavedAuthToken();
      } catch (error) {
        requestError = requestError ?? error;
      }
      setToken(null);
    }

    const phoneStillSignedIn = phoneSessionPresent && !phoneRevoked;
    setPreferredMethod(phoneStillSignedIn ? 'phone' : null);
    queryClient.clear();
    return requestError;
  }, [queryClient, token]);

  const clearAfterAccountDeletion = useCallback(async (): Promise<unknown | null> => {
    setAccountDeleted(true);
    setPreferredMethod(null);
    let requestError: unknown | null = null;
    await queryClient.cancelQueries();
    queryClient.clear();

    try {
      await AsyncStorage.setItem(DELETED_ACCOUNT_MARKER, '1');
    } catch (error) {
      requestError = error;
    }
    try {
      await clearSavedAuthToken();
    } catch (error) {
      requestError = requestError ?? error;
    }
    setToken(null);
    return requestError;
  }, [queryClient]);

  const clearNativeSession = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await clearSavedAuthToken().catch(() => undefined);
    setToken(null);
    setPreferredMethod(null);
    setStorageError(null);
  }, [queryClient]);

  const refreshIdentity = useCallback(async () => {
    if (accountDeleted) return;
    await identityQuery.refetch();
  }, [accountDeleted, identityQuery.refetch]);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    hasSession,
    accountDeleted,
    token,
    authMethod,
    identity: identityQuery.data,
    identityLoading: !ready || (!accountDeleted && identityQuery.isLoading),
    identityError: identityQuery.error,
    storageError,
    getApiToken,
    acceptSession,
    signOut,
    clearAfterAccountDeletion,
    clearNativeSession,
    refreshIdentity,
  }), [
    ready, hasSession, accountDeleted, token, authMethod, identityQuery.data,
    identityQuery.isLoading, identityQuery.error, storageError, getApiToken,
    acceptSession, signOut, clearAfterAccountDeletion, clearNativeSession, refreshIdentity,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}