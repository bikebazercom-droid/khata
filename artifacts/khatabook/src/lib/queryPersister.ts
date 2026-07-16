/**
 * queryPersister — offline-first cache bridge for React Query.
 *
 * Two public functions:
 *
 *   restoreCache(qc)  — call synchronously at module scope right after
 *                       creating the QueryClient. Reads the last-session
 *                       snapshot from localStorage and seeds every query
 *                       with its previous value so the UI renders with real
 *                       data before any network request fires.
 *
 *   persistCache(qc)  — subscribes to the query cache and writes successful
 *                       query results to localStorage in batches. Call once
 *                       at module scope alongside restoreCache.
 *
 * Design choices
 * ──────────────
 *  • localStorage (not IndexedDB) — synchronous reads mean we can seed the
 *    cache in the same JS tick that creates the QueryClient, before React
 *    even begins rendering. IndexedDB is async-only and would require a
 *    loading gate that defeats the purpose.
 *
 *  • 24-hour TTL — the whole store expires as a unit. Stale-enough data
 *    triggers a background refetch via React Query's normal staleTime logic.
 *
 *  • Versioned key — bump CACHE_KEY whenever the API response shape changes
 *    so old persisted data is automatically discarded.
 *
 *  • Debounced writes — multiple queries completing in the same tick are
 *    batched into one localStorage.setItem to avoid write storms.
 *
 *  • Quota-safe — if localStorage is full, oldest entries are pruned and we
 *    retry; if still failing we clear the store entirely rather than crashing.
 */

import type { QueryClient } from '@tanstack/react-query';

// Bump this string whenever the persisted data shape changes.
const CACHE_KEY = 'dkhata_qcache_v1';

/** Time-to-live for the entire cache snapshot (24 hours). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Query keys whose first element is in this set are excluded from
 * persistence. 'auth-me' is managed by authCache.ts; we don't want to
 * double-cache it here.
 */
const EXCLUDED_ROOTS = new Set<string>(['auth-me']);

// ── Internal store type ────────────────────────────────────────────────────────

interface Store {
  /** Timestamp of the last write — used for TTL checks. */
  ts: number;
  /**
   * Map of JSON-serialised query key → query data.
   * We intentionally store `unknown` because React Query data is typed at
   * the hook call site; the persister is type-agnostic.
   */
  entries: Record<string, unknown>;
}

// ── Internal singleton ────────────────────────────────────────────────────────

/** In-memory mirror of the store — avoids repeated JSON.parse on every read. */
let _store: Store | null = null;

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { ts: 0, entries: {} };
    const parsed = JSON.parse(raw) as Store;
    if (Date.now() - parsed.ts > MAX_AGE_MS) {
      // Expired — discard and start fresh.
      localStorage.removeItem(CACHE_KEY);
      return { ts: 0, entries: {} };
    }
    return parsed;
  } catch {
    return { ts: 0, entries: {} };
  }
}

function getStore(): Store {
  if (!_store) _store = loadStore();
  return _store;
}

// ── Debounced, quota-safe write ───────────────────────────────────────────────

let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (_flushTimer) return; // already scheduled
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushNow();
  }, 250);
}

function flushNow(): void {
  if (!_store) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(_store));
  } catch {
    // localStorage quota exceeded — trim the oldest half of entries.
    try {
      const entries = Object.entries(_store.entries);
      _store.entries = Object.fromEntries(entries.slice(Math.ceil(entries.length / 2)));
      localStorage.setItem(CACHE_KEY, JSON.stringify(_store));
    } catch {
      // Still failing — clear entirely so future writes succeed.
      localStorage.removeItem(CACHE_KEY);
      _store = { ts: 0, entries: {} };
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Seeds the QueryClient with every entry from the last-session localStorage
 * snapshot. Must be called synchronously at module scope — before React
 * renders — so HomeView, PartyView, etc. receive data on their first render
 * without waiting for network.
 *
 * The seeded data is immediately "stale" (React Query treats setQueryData
 * results as stale-by-default). React Query will silently refetch in the
 * background and update the UI when fresh data arrives, producing the
 * stale-while-revalidate pattern the user sees as an instant + always-fresh UI.
 */
export function restoreCache(qc: QueryClient): void {
  const store = getStore();
  for (const [keyStr, data] of Object.entries(store.entries)) {
    try {
      const key = JSON.parse(keyStr) as unknown[];
      if (!Array.isArray(key)) continue;
      if (typeof key[0] === 'string' && EXCLUDED_ROOTS.has(key[0])) continue;
      qc.setQueryData(key, data);
    } catch {
      // Malformed entry — skip silently.
    }
  }
}

/**
 * Subscribes to the query cache observer and persists each successful
 * fetch to localStorage. Returns the unsubscribe function.
 *
 * Call once at module scope. The subscription is lightweight — it only
 * runs on `updated` events with type `success`.
 */
export function persistCache(qc: QueryClient): () => void {
  return qc.getQueryCache().subscribe((event) => {
    // Only act on successful query completions.
    if (event.type !== 'updated') return;
    if (event.action.type !== 'success') return;

    const { queryKey, state } = event.query;
    if (state.data === undefined) return;

    // Skip excluded roots.
    if (Array.isArray(queryKey) && typeof queryKey[0] === 'string') {
      if (EXCLUDED_ROOTS.has(queryKey[0])) return;
    }

    const store = getStore();
    store.entries[JSON.stringify(queryKey)] = state.data;
    store.ts = Date.now();
    scheduleFlush();
  });
}

/**
 * Wipes the persisted cache from both memory and localStorage.
 * Call on logout so a different user signing in never sees the previous
 * user's data during the optimistic-render window.
 */
export function clearPersistedCache(): void {
  _store = null;
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}
