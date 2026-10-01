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
  pendingRead: null as PendingRead | null,
  events: [] as string[],
  requestTokens: [] as Array<string | null>,
  getToken: null as null | (() => Promise<string | null>),
  identityError: null as unknown,
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
    useGetAuthMe: (options: {
      query: { enabled?: boolean; queryKey: readonly unknown[]; staleTime?: number };
    }) => useTestQuery('identity', options.query.queryKey, {
      enabled: options.query.enabled,
      staleTime: options.query.staleTime,
    }),
    useListParties: () => useTestQuery('party-list', ['parties']),
    useGetParty: (partyId: string) => useTestQuery('party-detail', ['party', partyId]),
    useListLedgerEntries: (partyId: string) => useTestQuery('ledger', ['ledger', partyId]),
    useLogoutPhoneOtp: () => ({ mutateAsync: async () => undefined }),
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
  if (route === '/(tabs)/home') return <AuthenticatedQueries />;
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
    flow.secureToken = null;
    flow.pendingRead = null;
    flow.events.length = 0;
    flow.requestTokens.length = 0;
    flow.getToken = getSavedAuthToken;
    flow.identityError = null;
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
});