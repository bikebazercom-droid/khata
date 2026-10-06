import type { QueryClient } from '@tanstack/react-query';

interface PersistedQuery {
  key: string;
  actorId: string;
  businessId: string;
  queryKey: readonly unknown[];
  data: unknown;
  updatedAt: number;
}

interface CacheScope {
  actorId: string;
  businessId: string;
}

const DB_NAME = 'banglakhata-offline-cache';
const STORE_NAME = 'queries';
const CACHEABLE_QUERY_KEYS = new Set([
  'listParties',
  'getParty',
  'listLedgerEntries',
  'getDashboardSummary',
  'getGlobalLedgerReport',
  'getGlobalLedgerSummary',
  'getBusinessSettings',
]);

let databasePromise: Promise<IDBDatabase> | undefined;
let activeScope: CacheScope | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Offline cache unavailable'));
      request.onblocked = () => reject(new Error('Offline cache is blocked by another tab'));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise!;
}

function cacheableForScope(queryKey: readonly unknown[], businessId: string): boolean {
  const firstKey = queryKey[0];
  const finalKey = queryKey[queryKey.length - 1];
  if (typeof firstKey !== 'string' || !CACHEABLE_QUERY_KEYS.has(firstKey)) return false;
  if (typeof finalKey !== 'object' || finalKey === null || !('activeBusinessId' in finalKey)) return false;
  return (finalKey as { activeBusinessId?: unknown }).activeBusinessId ===
    (businessId || '__default_business__');
}

function snapshotKey(scope: CacheScope, queryHash: string) {
  return `${scope.actorId}:${scope.businessId}:${queryHash}`;
}

export function setQueryPersistenceScope(actorId: string, businessId: string): void {
  activeScope = { actorId, businessId };
}

export async function restorePersistedQueries(
  queryClient: QueryClient,
  actorId: string,
  businessId: string,
): Promise<void> {
  setQueryPersistenceScope(actorId, businessId);
  const database = await openDatabase();
  const snapshots = await new Promise<PersistedQuery[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as PersistedQuery[]);
    request.onerror = () => reject(request.error ?? new Error('Could not read offline cache'));
  });
  for (const snapshot of snapshots) {
    if (snapshot.actorId !== actorId || snapshot.businessId !== businessId) continue;
    if (!cacheableForScope(snapshot.queryKey, businessId)) continue;
    queryClient.setQueryData(snapshot.queryKey, snapshot.data, { updatedAt: snapshot.updatedAt });
  }
}

export async function clearPersistedQueries(actorId?: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const snapshots = request.result as PersistedQuery[];
      for (const snapshot of snapshots) {
        if (!actorId || snapshot.actorId === actorId) store.delete(snapshot.key);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Could not clear offline cache'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear offline cache'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline cache clear aborted'));
  });
}

/** Persist only business-scoped ledger data; auth tokens and unrelated queries never enter IndexedDB. */
export function persistCache(queryClient: QueryClient): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const scope = activeScope;
    const query = event.query;
    if (!scope || query.state.data === undefined ||
      !cacheableForScope(query.queryKey, scope.businessId)) return;

    const snapshot: PersistedQuery = {
      key: snapshotKey(scope, query.queryHash),
      actorId: scope.actorId,
      businessId: scope.businessId,
      queryKey: query.queryKey,
      data: query.state.data,
      updatedAt: query.state.dataUpdatedAt,
    };
    void openDatabase().then((database) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(snapshot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save offline cache'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline cache save aborted'));
    })).catch(() => {
      // The live ledger remains usable if local browser storage is unavailable.
    });
  });
}
