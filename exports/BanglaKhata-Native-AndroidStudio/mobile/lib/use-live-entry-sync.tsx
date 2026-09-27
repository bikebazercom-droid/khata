import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import EventSource from 'react-native-sse';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthRole, notifyMobileIdentityChanged } from './auth-role';
import { API_BASE_URL } from './api-base';

/** Keep authenticated server events and visible queries in sync while foregrounded. */
export function LiveEntrySync() {
  const { identity } = useAuthRole();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const scope = identity ? `${identity.userId}:${identity.businessId}` : '';
  const activeScope = useRef(scope);
  activeScope.current = scope;

  useEffect(() => {
    if (!identity || !API_BASE_URL) return;
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
    const refresh = () => {
      if (!current() || !connected) return;
      void qc.invalidateQueries();
    };
    const open = async () => {
      const thisGeneration = ++generation;
      source?.close();
      source = undefined;
      if (!current() || !connected) return;
      const authToken = await token();
      if (!current() || !connected || !authToken || generation !== thisGeneration) return;
      const events = new EventSource<'connected' | 'ledger.created' | 'ledger.updated' | 'ledger.deleted' |
        'party.created' | 'party.deleted' | 'settings.updated'>(`${API_BASE_URL}/api/events`, {
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
    void open();
    // Refresh the auth token periodically for long-lived streams.
    const renew = setInterval(() => { if (current()) { void open(); refresh(); } }, 5 * 60_000);
    return () => {
      active = false;
      generation++;
      source?.close();
      appState.remove();
      network();
      clearInterval(renew);
      if (authorizationRetry) clearTimeout(authorizationRetry);
    };
  }, [scope, identity?.userId, identity?.businessId, getToken, qc]);
  return null;
}