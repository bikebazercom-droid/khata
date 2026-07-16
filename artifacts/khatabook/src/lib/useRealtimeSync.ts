/**
 * useRealtimeSync — subscribes to the server's SSE event channel and
 * invalidates the relevant React Query caches when a remote device writes.
 *
 * Design goals:
 * - Zero loading spinners: invalidation triggers background refetches; the
 *   UI just updates when fresh data arrives, exactly like local optimistic
 *   updates do.
 * - Silent reconnect: native EventSource reconnects automatically; on
 *   reconnect we invalidate ALL queries so any missed events are caught up.
 * - No extra dependencies: uses the native EventSource API.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardSummaryQueryKey,
  getListPartiesQueryKey,
  getGetPartyQueryKey,
  getListLedgerEntriesQueryKey,
  getGetBusinessSettingsQueryKey,
  getListGlobalLedgerEntriesQueryKey,
} from '@workspace/api-client-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Opens an SSE connection to /api/events and invalidates queries when the
 * server broadcasts writes from another device.
 *
 * @param enabled - Only opens the connection when true. Pass `isAuthenticated`
 *   from useAppAuth so we don't attempt an unauthenticated connection.
 */
export function useRealtimeSync(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const url = `${BASE}/api/events`;
    const es = new EventSource(url, { withCredentials: true });

    // On (re)connect, invalidate everything so missed events are caught up
    // silently in the background.
    es.addEventListener('connected', () => {
      void qc.invalidateQueries();
    });

    // party.created — new party added on another device
    es.addEventListener('party.created', () => {
      void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    });

    // party.deleted — party removed on another device
    es.addEventListener('party.deleted', (e: MessageEvent) => {
      try {
        const { partyId } = JSON.parse(e.data) as { partyId: string };
        void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
      } catch {
        void qc.invalidateQueries();
      }
    });

    // ledger.created — new transaction added on another device
    es.addEventListener('ledger.created', (e: MessageEvent) => {
      try {
        const { partyId } = JSON.parse(e.data) as { partyId: string };
        void qc.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey() });
      } catch {
        void qc.invalidateQueries();
      }
    });

    // settings.updated — business settings changed on another device
    es.addEventListener('settings.updated', () => {
      void qc.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
    });

    // EventSource self-reconnects on error/drop; no manual retry needed.
    // The 'connected' event on the next successful connection triggers
    // a full re-sync to catch up on anything missed while disconnected.

    return () => {
      es.close();
    };
  }, [enabled, qc]);
}
