import type { QueryClient } from '@tanstack/react-query';

// This is a local, per-browser *view*, not an authentication credential.
// Never restore the legacy unscoped snapshot.
const PREFIX = 'dkhata_offline_view_v2:';
const LEGACY = 'dkhata_qcache_v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
let scope: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
type Snapshot = { ts: number; entries: Record<string, unknown> };

export function permittedQueryKey(key: readonly unknown[]): boolean {
  if (typeof key[0] !== 'string') return false;
  return key[0] === '/api/parties' ||
    /^\/api\/parties\/[^/]+(?:\/ledger-entries)?$/.test(key[0]);
}

function storageKey(actor: string, role: string, business: string) {
  return PREFIX + encodeURIComponent(JSON.stringify([actor, role, business]));
}

function read(key: string): Snapshot {
  try {
    const value = localStorage.getItem(key);
    if (!value) return { ts: 0, entries: {} };
    const parsed = JSON.parse(value) as Snapshot;
    if (typeof parsed.ts !== 'number' || !parsed.entries || typeof parsed.entries !== 'object' || Date.now() - parsed.ts > MAX_AGE) {
      localStorage.removeItem(key);
      return { ts: 0, entries: {} };
    }
    return parsed;
  } catch {
    return { ts: 0, entries: {} };
  }
}

export function getOfflineEntries(actor: string, role: string, business: string): Record<string, unknown> {
  const entries = read(storageKey(actor, role, business)).entries;
  return Object.fromEntries(Object.entries(entries).filter(([key]) => {
    try { return permittedQueryKey(JSON.parse(key)); } catch { return false; }
  }));
}

// Called only after /api/auth/me confirms the actor and business permission.
export function setPersistedScope(qc: QueryClient, actor: string, role: string, business: string): void {
  const next = storageKey(actor, role, business);
  if (scope === next) return;
  if (timer) clearTimeout(timer);
  if (scope) qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth-me' });
  scope = next;
  // Do not optimistically restore a private view while online: permissions may
  // have changed since the snapshot. Fresh server queries refill this scope.
}

export function persistCache(qc: QueryClient): () => void {
  try { localStorage.removeItem(LEGACY); } catch { /* storage unavailable */ }
  return qc.getQueryCache().subscribe((event) => {
    if (!scope || event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    const { queryKey, state } = event.query;
    if (!permittedQueryKey(queryKey) || state.data === undefined) return;
    const currentScope = scope;
    const data = state.data;
    const key = JSON.stringify(queryKey);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (scope !== currentScope) return;
      const snapshot = read(currentScope);
      snapshot.entries[key] = data;
      snapshot.ts = Date.now();
      try { localStorage.setItem(currentScope, JSON.stringify(snapshot)); }
      catch { /* Quota exhaustion must never affect ledger writes or the outbox. */ }
    }, 250);
  });
}

export function evictPersistedCacheEntries(keys: ReadonlyArray<readonly unknown[]>): void {
  if (!scope) return;
  const snapshot = read(scope);
  for (const key of keys) delete snapshot.entries[JSON.stringify(key)];
  try { localStorage.setItem(scope, JSON.stringify(snapshot)); } catch { /* ignore */ }
}

// Preserve actor-scoped drafts in IndexedDB. Remove only the active view.
export function clearPersistedCache(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (scope) {
    try { localStorage.removeItem(scope); } catch { /* ignore */ }
  }
  scope = null;
  try { localStorage.removeItem(LEGACY); } catch { /* ignore */ }
}

export function pausePersistedCache(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  scope = null;
}

export function clearActorViews(actor: string): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const parsed = JSON.parse(decodeURIComponent(key.slice(PREFIX.length))) as string[];
      if (parsed[0] === actor) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
  pausePersistedCache();
}