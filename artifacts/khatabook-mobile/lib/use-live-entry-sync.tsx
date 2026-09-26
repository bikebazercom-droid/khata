import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import EventSource from 'react-native-sse';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthRole, notifyMobileIdentityChanged } from './auth-role';
import { drainEntries, subscribeOutbox } from './entry-outbox';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

/** Background push while foregrounded; refetch and replay after every reconnect. */
export function LiveEntrySync() {
  const { identity } = useAuthRole();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const scope = identity ? `${identity.userId}:${identity.businessId}` : '';
  const activeScope = useRef(scope);
  activeScope.current = scope;

  useEffect(() => {
    if (!identity || !DOMAIN) return;
    let active = true;
    let connected = true;
    let generation = 0;
    let authorizationRetry: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource<'connected' | 'ledger.created' | 'ledger.updated' | 'ledger.deleted' |
      'party.created' | 'party.deleted' | 'settings.updated'> | undefined;
    const current = () => active && activeScope.current === scope && AppState.currentState === 'active';
    const token = async () => {
      const clerkToken = await getToken().catch(() => null);
      return clerkToken ?? await SecureStore.getItemAsync('phone_session_token').catch(() => null);
    };
    const replay = () => {
      if (current() && connected) {
        void drainEntries(identity.userId, identity.businessId, current, () => {
          if (current()) void qc.invalidateQueries();
        }).catch(() => { /* Draft remains stored; visible in the party screen. */ });
      }
    };
    const refresh = () => {
      if (!current() || !connected) return;
      void qc.invalidateQueries();
      replay();
    };
    const open = async () => {
      const thisGeneration = ++generation;
      source?.close();
      source = undefined;
      if (!current() || !connected) return;
      const authToken = await token();
      if (!current() || !connected || !authToken || generation !== thisGeneration) return;
      const events = new EventSource<'connected' | 'ledger.created' | 'ledger.updated' | 'ledger.deleted' |
        'party.created' | 'party.deleted' | 'settings.updated'>(`https://${DOMAIN}/api/events`, {
        headers: { Authorization: `Bearer ${authToken}`, 'x-business-id': identity.businessId },
        pollingInterval: 3000,
      });
      if (!current() || generation !== thisGeneration) { events.close(); return; }
      source = events;
      events.addEventListener('connected', refresh);
      for (const name of ['ledger.created', 'ledger.updated', 'ledger.deleted',
        'party.created', 'party.deleted', 'settings.updated'] as const) {
        events.addEventListener(name, refresh);
      }
      events.addEventListener('error', (event) => {
        if ('xhrStatus' in event && event.xhrStatus === 401) {
          notifyMobileIdentityChanged();
          if (!authorizationRetry) {
            authorizationRetry = setTimeout(() => {
              authorizationRetry = undefined;
              if (current()) void open();
            }, 3_000);
          }
        }
      });
      refresh(); // Also recover before SSE handshake if the network has returned.
    };
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') { void open(); refresh(); }
      else { generation++; source?.close(); source = undefined; }
    });
    const network = NetInfo.addEventListener((state) => {
      const reachable = state.isConnected !== false && state.isInternetReachable !== false;
      if (reachable !== connected) {
        connected = reachable;
        if (reachable) { void open(); refresh(); }
        else { generation++; source?.close(); source = undefined; }
      }
    });
    const unsubscribe = subscribeOutbox(replay);
    void open();
    // Refresh token periodically for long-lived streams and retry transient
    // writes even when no connectivity-change event was delivered by Android.
    const retry = setInterval(replay, 15_000);
    const renew = setInterval(() => { if (current()) { void open(); refresh(); } }, 5 * 60_000);
    return () => {
      active = false;
      generation++;
      source?.close();
      appState.remove();
      network();
      unsubscribe();
      clearInterval(retry);
      clearInterval(renew);
      if (authorizationRetry) clearTimeout(authorizationRetry);
    };
  }, [scope, identity?.userId, identity?.businessId, getToken, qc]);
  return null;
}