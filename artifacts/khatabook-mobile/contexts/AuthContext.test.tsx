import React, { type ReactNode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useGetParty,
  useListLedgerEntries,
  useListParties,
} from '@workspace/api-client-react';

type PendingRead = {
  promise: Promise<string | null>;
  resolve: (token: string | null) => void;
};

const flow = vi.hoisted(() => ({
  secureToken: null as string | null,
  platform: 'ios',
  clerkSignedIn: false,
  pendingRead: null as PendingRead | null,
  events: [] as string[],
  requestTokens: [] as Array<string | null>,
  getToken: null as null | (() => Promise<string | null>),
  identityError: null as unknown,
  logout: vi.fn(),
  logoutEvent: vi.fn(),
  clerkGetToken: vi.fn(),
  clerkSignOut: vi.fn(),
  identity: {
    role: 'owner' as const,
    businessId: 'test-business',
    userId: 'test-owner',
    businessName: 'Test shop',
    authMethod: 'phone' as const,
    adjustmentPartyIds: [] as string[],
  },
}));

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { get OS() { return flow.platform; } },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => undefined),
    setItem: vi.fn(async () => undefined),
  },
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: flow.clerkSignedIn,
    getToken: flow.clerkGetToken,
    signOut: flow.clerkSignOut,
  }),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => {
    flow.events.push('secure-read-start');
    const token = flow.pendingRead
      ? await flow.pendingRead.promise
      : flow.secureToken;
    flow.events.push('secure-read-finished');
    return token;
  }),
  setItemAsync: vi.fn(async (_key: string, token: string) => {
    flow.events.push('secure-write');
    flow.secureToken = token;
  }),
  deleteItemAsync: vi.fn(async () => {
    flow.events.push('secure-delete');
    flow.secureToken = null;
  }),
}));

vi.mock('@workspace/api-client-react', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  const useTestQuery = (
    name: string,
    queryKey: readonly unknown[],
    options: { enabled?: boolean; staleTime?: number } = {},
  ) => useQuery({
    queryKey,
    ...options,
    retry: false,
    queryFn: async () => {
      flow.events.push(`${name}-query-start`);
      const token = await flow.getToken?.();
      flow.requestTokens.push(token ?? null);
      flow.events.push(`${name}-query-finished`);
      if (name === 'identity' && flow.identityError) throw flow.identityError;
      return name === 'identity' ? flow.identity : [];
    },
  });

  return {
    getGetAuthMeQueryKey: () => ['auth', 'me'] as const,
    setAuthTokenGetter: (getter: (() => Promise<string | null>) | null) => {
      flow.getToken = getter;
    },
    useGetAuthMe: (options: {
      query: { enabled?: boolean; queryKey: readonly unknown[]; staleTime?: number };
    }) => useTestQuery('identity', options.query.queryKey, {
      enabled: options.query.enabled,
      staleTime: options.query.staleTime,
    }),
    useListParties: () => useTestQuery('party-list', ['parties']),
    useGetParty: (partyId: string) => useTestQuery('party-detail', ['party', partyId]),
    useListLedgerEntries: (partyId: string) => useTestQuery('ledger', ['ledger', partyId]),
    logoutPhoneOtp: flow.logout,
    reportAuthLogoutEvent: flow.logoutEvent,
  };
});

vi.mock('@/lib/domain', () => ({
  isUnauthorized: (error: unknown) =>
    typeof error === 'object' && error !== null && 'status' in error &&
    (error as { status?: number }).status === 401,
  errorMessage: () => 'Unable to load account',
}));

vi.mock('expo-router', () => ({ router: routerMock }));

vi.mock('@/components/Kit', () => ({
  AppButton: () => null,
  LoadingState: () => null,
  Notice: () => null,
  Page: ({ children }: { children?: ReactNode }) => children ?? null,
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import IndexScreen from '@/app/index';
import { getSavedAuthToken } from '@/lib/authStorage';

type AuthState = ReturnType<typeof useAuth>;

function AuthProbe({ capture }: { capture: (state: AuthState) => void }) {
  const state = useAuth();
  capture(state);
  return <div data-testid="auth-state">{JSON.stringify({
    ready: state.ready,
    token: state.token,
    userId: state.identity?.userId ?? null,
  })}</div>;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

let routeSetState: ((route: string) => void) | undefined;

function AuthenticatedQueries() {
  useListParties({});
  useGetParty('test-party');
  useListLedgerEntries('test-party');
  return null;
}

function MockRouteTree() {
  const [route, setRoute] = React.useState('/');
  routeSetState = setRoute;

  React.useEffect(() => () => {
    routeSetState = undefined;
  }, []);

  if (route === '/') return <IndexScreen />;
  if (route === '/(tabs)/parties') return <AuthenticatedQueries />;
  return null;
}

function renderWithAuth(children: ReactNode, queryClient = createQueryClient()) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('mobile phone-session restoration', () => {
  beforeEach(() => {
    flow.platform = 'ios';
    flow.clerkSignedIn = false;
    flow.secureToken = null;
    flow.pendingRead = null;
    flow.events.length = 0;
    flow.requestTokens.length = 0;
    flow.getToken = getSavedAuthToken;
    flow.identityError = null;
    flow.logout.mockReset().mockResolvedValue(undefined);
    flow.logoutEvent.mockReset().mockResolvedValue(undefined);
    flow.clerkGetToken.mockReset().mockResolvedValue(null);
    flow.clerkSignOut.mockReset().mockImplementation(async () => {
      flow.clerkSignedIn = false;
    });
    routerMock.replace.mockReset();
    routerMock.replace.mockImplementation((route: string) => {
      routeSetState?.(route);
    });
    routerMock.push.mockReset();
    routeSetState = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('waits for SecureStore before making the authenticated identity request', async () => {
    let resolveRead!: (token: string | null) => void;
    const promise = new Promise<string | null>((resolve) => {
      resolveRead = resolve;
    });
    flow.pendingRead = { promise, resolve: resolveRead };

    let currentState: AuthState | undefined;
    const view = renderWithAuth(
      <>
        <AuthProbe capture={(state) => { currentState = state; }} />
        <MockRouteTree />
      </>,
    );

    await waitFor(() => expect(flow.events).toContain('secure-read-start'));
    expect(flow.events).not.toContain('identity-query-start');

    await act(async () => {
      flow.pendingRead?.resolve('restored-phone-session');
    });

    await waitFor(() => expect(currentState?.identity?.userId).toBe('test-owner'));
    await waitFor(() => expect(flow.requestTokens).toHaveLength(4));
    expect(currentState?.token).toBe('restored-phone-session');
    expect(flow.requestTokens).toEqual(Array(4).fill('restored-phone-session'));
    expect(flow.events.indexOf('secure-read-finished'))
      .toBeLessThan(flow.events.indexOf('identity-query-start'));
    const identityFinished = flow.events.indexOf('identity-query-finished');
    for (const queryName of ['party-list', 'party-detail', 'ledger']) {
      expect(flow.events.indexOf(`${queryName}-query-start`)).toBeGreaterThan(identityFinished);
    }

    view.unmount();
    view.queryClient.clear();
  });

  it('stores an accepted session and restores it after the provider remounts', async () => {
    let currentState: AuthState | undefined;
    const firstView = renderWithAuth(<AuthProbe capture={(state) => { currentState = state; }} />);
    await waitFor(() => expect(currentState?.ready).toBe(true));

    await act(async () => {
      await currentState?.acceptSession({ token: 'new-phone-session' });
    });
    await waitFor(() => expect(currentState?.identity?.userId).toBe('test-owner'));
    expect(flow.secureToken).toBe('new-phone-session');
    expect(flow.events.indexOf('secure-write'))
      .toBeLessThan(flow.events.indexOf('identity-query-start'));
    expect(flow.requestTokens).toContain('new-phone-session');

    firstView.unmount();
    firstView.queryClient.clear();
    flow.events.length = 0;
    flow.requestTokens.length = 0;

    const secondState: { current?: AuthState } = {};
    const secondView = renderWithAuth(
      <AuthProbe capture={(state) => { secondState.current = state; }} />,
    );
    await waitFor(() => expect(secondState.current?.identity?.userId).toBe('test-owner'));
    expect(secondState.current?.token).toBe('new-phone-session');
    expect(flow.requestTokens).toEqual(['new-phone-session']);
    expect(flow.events.indexOf('secure-read-finished'))
      .toBeLessThan(flow.events.indexOf('identity-query-start'));

    secondView.unmount();
    secondView.queryClient.clear();
  });

  it('clears an unauthorized saved session and returns the app to sign-in', async () => {
    flow.secureToken = 'revoked-phone-session';
    flow.identityError = { status: 401 };

    let currentState: AuthState | undefined;
    const view = renderWithAuth(
      <>
        <AuthProbe capture={(state) => { currentState = state; }} />
        <MockRouteTree />
      </>,
    );

    await waitFor(() => expect(flow.requestTokens).toEqual(['revoked-phone-session']));
    await waitFor(() => expect(currentState?.token).toBeNull());
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/sign-in'));

    expect(flow.secureToken).toBeNull();
    expect(flow.events).toContain('secure-delete');

    view.unmount();
    view.queryClient.clear();
  });

  it('restores and accepts a web cookie session without touching SecureStore or keeping the bearer token', async () => {
    flow.platform = 'web';
    flow.getToken = null;
    let currentState: AuthState | undefined;
    const view = renderWithAuth(
      <>
        <AuthProbe capture={(state) => { currentState = state; }} />
        <MockRouteTree />
      </>,
    );

    await waitFor(() => expect(currentState?.identity?.userId).toBe('test-owner'));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/(tabs)/parties'));
    expect(flow.events).not.toContain('secure-read-start');

    await act(async () => {
      await currentState?.acceptSession({ token: 'web-response-bearer-must-not-persist' });
    });
    await waitFor(() => expect(flow.events.filter((event) => event === 'identity-query-start')).toHaveLength(2));
    expect(currentState?.token).toBeNull();
    expect(flow.secureToken).toBeNull();
    expect(flow.events).not.toContain('secure-write');
    expect(flow.events).not.toContain('secure-read-start');

    await act(async () => {
      await currentState?.signOut();
    });
    expect(flow.logout).toHaveBeenCalledOnce();
    expect(flow.events).not.toContain('secure-delete');
    expect(flow.events).not.toContain('secure-write');

    view.unmount();
    view.queryClient.clear();
  });

  it('revokes simultaneous Clerk and phone sessions with their own bearer tokens', async () => {
    flow.secureToken = 'phone-session-token';
    flow.clerkSignedIn = true;
    flow.clerkGetToken.mockResolvedValue('clerk-session-token');

    let currentState: AuthState | undefined;
    const view = renderWithAuth(<AuthProbe capture={(state) => { currentState = state; }} />);
    await waitFor(() => expect(currentState?.token).toBe('phone-session-token'));

    let signOutError: unknown;
    await act(async () => {
      signOutError = await currentState?.signOut();
    });

    expect(signOutError).toBeNull();
    expect(flow.logoutEvent).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer clerk-session-token' },
    });
    expect(flow.logout).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer phone-session-token' },
    });
    expect(flow.clerkSignOut).toHaveBeenCalledOnce();
    expect(flow.secureToken).toBeNull();

    view.unmount();
    view.queryClient.clear();
  });

  it('keeps the saved phone credential when server revocation fails', async () => {
    flow.secureToken = 'phone-session-token';
    flow.logout.mockRejectedValueOnce(new Error('revocation failed'));

    let currentState: AuthState | undefined;
    const view = renderWithAuth(<AuthProbe capture={(state) => { currentState = state; }} />);
    await waitFor(() => expect(currentState?.token).toBe('phone-session-token'));

    let signOutError: unknown;
    await act(async () => {
      signOutError = await currentState?.signOut();
    });

    expect(signOutError).toBeInstanceOf(Error);
    expect(flow.secureToken).toBe('phone-session-token');
    expect(flow.events).not.toContain('secure-delete');
    expect(flow.clerkSignOut).not.toHaveBeenCalled();

    view.unmount();
    view.queryClient.clear();
  });
});