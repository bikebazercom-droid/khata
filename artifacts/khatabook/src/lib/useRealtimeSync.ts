/**
 * useRealtimeSync — subscribes to the server's SSE event channel and
 * invalidates the relevant React Query caches when a remote device writes.
 *
 * ─── Design goals ─────────────────────────────────────────────────────────
 *
 * ZERO SPINNERS
 *   invalidateQueries() triggers background refetches only. React Query
 *   serves the cached value while the fresh data loads — the UI never
 *   shows a loading state for server-push updates.
 *
 * TARGETED INVALIDATION
 *   Each event type invalidates only the queries that are actually affected,
 *   keeping unnecessary network traffic to a minimum. The `connected` event
 *   (fired on every (re)connect) performs a full sweep to catch any events
 *   that were missed during a disconnect.
 *
 * DEBOUNCED OFFLINE DETECTION
 *   SSE fires `error` on every brief TCP hiccup — internet cell drops,
 *   proxy resets, laptop lid-close — even when the connection restores in
 *   milliseconds. Marking the UI "offline" on the first error would cause
 *   the badge to flicker constantly. Instead we start a 3-second grace
 *   timer; if the SSE reconnects (fires `connected`) before the timer
 *   fires, we cancel it and the badge never changes. Only a sustained
 *   disconnect triggers the offline state.
 *
 * MULTI-TRIGGER RESYNC
 *   Three independent triggers perform a background sync:
 *   1. SSE `connected` event — fires on every successful (re)connection.
 *   2. Browser `online` event — fires the moment the device regains a
 *      network interface. Acts as a safety net when SSE takes time to
 *      reconnect (keeps cache current even before the SSE handshake).
 *   3. `visibilitychange` — fires when the user switches back to the tab.
 *      Browsers aggressively throttle or suspend SSE connections for
 *      background tabs. If the tab was hidden for longer than
 *      VISIBILITY_STALE_THRESHOLD_MS, we do a full invalidation the moment
 *      it becomes visible again, regardless of SSE state.
 *
 * SELF-HEALING SSE
 *   Native EventSource reconnects automatically with browser-managed
 *   exponential back-off. The server also sends a `retry: 3000` directive
 *   so the first reconnect attempt happens within 3 seconds.
 */

import { useEffect, useRef } from 'react';
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

/** How long (ms) to wait before marking the app "offline" after an SSE error. */
const OFFLINE_GRACE_MS = 3_000;

/**
 * If the tab has been hidden for longer than this (ms), perform a full
 * cache invalidation the moment it becomes visible again. The assumption
 * is that the SSE connection was suspended by the browser and any amount
 * of remote writes could have happened.
 */
const VISIBILITY_STALE_THRESHOLD_MS = 60_000;

/**
 * Opens an SSE connection to /api/events and invalidates queries when the
 * server broadcasts writes from another device.
 *
 * @param enabled - Only opens the connection when true. Pass `isAuthenticated`
 *   so we don't attempt an un-authed connection on the landing / sign-in page.
 * @param onConnectionChange - Called with `true` when the SSE connection is
 *   established and `false` when it is definitively lost (after the grace period).
 */
export function useRealtimeSync(
  enabled: boolean,
  onConnectionChange?: (isOnline: boolean) => void,
) {
  const qc = useQueryClient();
  // Stable ref so visibilitychange listener doesn't re-close over stale `qc`.
  const qcRef = useRef(qc);
  qcRef.current = qc;

  useEffect(() => {
    if (!enabled) return;

    // ── Open SSE connection ───────────────────────────────────────────────
    const es = new EventSource(`${BASE}/api/events`, { withCredentials: true });

    // ── Offline grace timer ───────────────────────────────────────────────
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;

    function markOnline() {
      if (offlineTimer !== null) {
        clearTimeout(offlineTimer);
        offlineTimer = null;
      }
      onConnectionChange?.(true);
    }

    function scheduleOffline() {
      if (offlineTimer !== null) return; // timer already ticking
      offlineTimer = setTimeout(() => {
        offlineTimer = null;
        onConnectionChange?.(false);
      }, OFFLINE_GRACE_MS);
    }

    // ── Visibility tracking ───────────────────────────────────────────────
    let hiddenAt: number | null = null;

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      // Tab is now visible.
      const hiddenMs = hiddenAt !== null ? Date.now() - hiddenAt : 0;
      hiddenAt = null;

      if (hiddenMs >= VISIBILITY_STALE_THRESHOLD_MS) {
        // Potentially missed many events — full sweep.
        void qcRef.current.invalidateQueries();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ── Browser online event (backup sync trigger) ────────────────────────
    function handleBrowserOnline() {
      // The SSE will reconnect and fire `connected` momentarily, which also
      // triggers invalidateQueries. This listener is a safety net for the
      // window between the browser regaining network and the SSE handshake
      // completing — keeps the cache current as quickly as possible.
      void qcRef.current.invalidateQueries();
    }

    window.addEventListener('online', handleBrowserOnline);

    // ── SSE event handlers ────────────────────────────────────────────────

    // (Re)connect: sweep all caches to catch up on missed events.
    es.addEventListener('connected', () => {
      markOnline();
      void qc.invalidateQueries();
    });

    // SSE error (dropped connection / brief blip): start grace timer.
    es.addEventListener('error', () => {
      scheduleOffline();
    });

    // ─── party.created ────────────────────────────────────────────────────
    es.addEventListener('party.created', () => {
      void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    });

    // ─── party.deleted ────────────────────────────────────────────────────
    es.addEventListener('party.deleted', (e: MessageEvent) => {
      try {
        const { partyId } = JSON.parse(e.data as string) as { partyId: string };
        void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey() });
      } catch {
        void qc.invalidateQueries();
      }
    });

    // ─── ledger.created ───────────────────────────────────────────────────
    es.addEventListener('ledger.created', (e: MessageEvent) => {
      try {
        const { partyId } = JSON.parse(e.data as string) as { partyId: string };
        void qc.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey() });
      } catch {
        void qc.invalidateQueries();
      }
    });

    // ─── ledger.updated ───────────────────────────────────────────────────
    // Fired when a ledger entry is patched (e.g. bill image attached after
    // the initial offline→online retry). Payload: { partyId, entryId }.
    es.addEventListener('ledger.updated', (e: MessageEvent) => {
      try {
        const { partyId } = JSON.parse(e.data as string) as { partyId: string };
        void qc.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey() });
      } catch {
        void qc.invalidateQueries();
      }
    });

    // ─── ledger.deleted ───────────────────────────────────────────────────
    // Fired when a transaction is deleted from any device. Payload: { partyId, entryId }.
    // On the originating device the caches are already updated optimistically;
    // these invalidations reconcile them with the server's authoritative response
    // and propagate the deletion to all other devices simultaneously.
    es.addEventListener('ledger.deleted', (e: MessageEvent) => {
      try {
        const { partyId } = JSON.parse(e.data as string) as { partyId: string };
        void qc.invalidateQueries({ queryKey: getListLedgerEntriesQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getGetPartyQueryKey(partyId) });
        void qc.invalidateQueries({ queryKey: getListPartiesQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListGlobalLedgerEntriesQueryKey() });
      } catch {
        void qc.invalidateQueries();
      }
    });

    // ─── settings.updated ─────────────────────────────────────────────────
    es.addEventListener('settings.updated', () => {
      void qc.invalidateQueries({ queryKey: getGetBusinessSettingsQueryKey() });
    });

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      es.close();
      if (offlineTimer !== null) clearTimeout(offlineTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleBrowserOnline);
    };
  }, [enabled, onConnectionChange, qc]);
}
