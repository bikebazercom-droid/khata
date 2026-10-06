import { createParty, deleteParty, getParty, updateParty, type Party, type PartyInput, type PartyUpdate } from '@workspace/api-client-react';
import type { QueryClient, Query } from '@tanstack/react-query';
import { listEntries } from './entryOutbox';

export type PartyOperationKind = 'create' | 'update' | 'delete';

export interface QueuedPartyOperation {
  id: string;
  actorId: string;
  businessId: string;
  partyId: string;
  kind: PartyOperationKind;
  data?: PartyInput | PartyUpdate;
  optimisticParty?: Party;
  beforeParty?: Party;
  createdAt: string;
  status: 'pending' | 'rejected';
  error?: string;
}

export const PARTY_OUTBOX_CHANGED = 'banglakhata-party-outbox-changed';
export const PARTY_OUTBOX_REJECTED = 'banglakhata-party-outbox-rejected';

const DB_NAME = 'banglakhata-party-outbox';
const STORE_NAME = 'operations';
let databasePromise: Promise<IDBDatabase> | undefined;
let draining = false;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Offline customer storage unavailable'));
      request.onblocked = () => reject(new Error('Offline customer storage is blocked by another tab'));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise!;
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline customer change could not be saved'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline customer change was cancelled'));
  });
}

function emitChanged() {
  window.dispatchEvent(new Event(PARTY_OUTBOX_CHANGED));
}

export async function queuePartyOperation(operation: QueuedPartyOperation): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const scoped = (request.result as QueuedPartyOperation[]).filter((item) =>
        item.actorId === operation.actorId &&
        item.businessId === operation.businessId &&
        item.partyId === operation.partyId &&
        item.status === 'pending',
      );
      const pendingCreate = scoped.find((item) => item.kind === 'create');
      const pendingUpdate = scoped.find((item) => item.kind === 'update');
      if (operation.kind === 'update' && pendingCreate) {
        pendingCreate.data = { ...(pendingCreate.data as PartyInput), ...(operation.data as PartyUpdate) };
        pendingCreate.optimisticParty = operation.optimisticParty;
        store.put(pendingCreate);
      } else if (operation.kind === 'update' && pendingUpdate) {
        pendingUpdate.data = { ...(pendingUpdate.data as PartyUpdate), ...(operation.data as PartyUpdate) };
        pendingUpdate.optimisticParty = operation.optimisticParty;
        store.put(pendingUpdate);
      } else if (operation.kind === 'create' && pendingCreate) {
        pendingCreate.data = operation.data;
        pendingCreate.optimisticParty = operation.optimisticParty;
        store.put(pendingCreate);
      } else {
        store.put(operation);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Offline customer change could not be saved'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline customer change could not be saved'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline customer change was cancelled'));
  });
  emitChanged();
}

export async function listPartyOperations(actorId: string, businessId: string): Promise<QueuedPartyOperation[]> {
  const operations = await runTransaction<QueuedPartyOperation[]>('readonly', (store) => store.getAll());
  return operations
    .filter((operation) => operation.actorId === actorId && operation.businessId === businessId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function saveOperation(operation: QueuedPartyOperation): Promise<void> {
  await runTransaction('readwrite', (store) => store.put(operation));
  emitChanged();
}

async function removeOperation(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id));
  emitChanged();
}

function hasBusinessScope(query: Query, businessId: string): boolean {
  const lastKey = query.queryKey[query.queryKey.length - 1];
  return typeof lastKey === 'object' && lastKey !== null &&
    'activeBusinessId' in lastKey &&
    (lastKey as { activeBusinessId?: unknown }).activeBusinessId === (businessId || '__default_business__');
}

function matchesListParams(party: Party, query: Query): boolean {
  const params = query.queryKey[1];
  if (typeof params !== 'object' || params === null) return true;
  const filter = params as { role?: string; search?: string; dueFilter?: string };
  if (filter.role && filter.role !== party.role) return false;
  if (filter.search) {
    const search = filter.search.trim().toLocaleLowerCase();
    if (search && !party.name.toLocaleLowerCase().includes(search) && !party.phone.toLocaleLowerCase().includes(search)) return false;
  }
  if (filter.dueFilter) {
    const today = new Date().toISOString().slice(0, 10);
    if (filter.dueFilter === 'DUE_TODAY' && party.dueDate !== today) return false;
    if (filter.dueFilter === 'UPCOMING' && (!party.dueDate || party.dueDate <= today)) return false;
    if (filter.dueFilter === 'NO_DUE_DATE' && party.dueDate) return false;
  }
  return true;
}

function applyParty(queryClient: QueryClient, businessId: string, kind: PartyOperationKind, party: Party) {
  const listQueries = queryClient.getQueryCache().findAll({
    predicate: (query) => query.queryKey[0] === 'listParties' && hasBusinessScope(query, businessId),
  });
  for (const query of listQueries) {
    queryClient.setQueryData<Party[]>(query.queryKey, (old) => {
      if (!Array.isArray(old)) return old;
      const withoutParty = old.filter((item) => item.id !== party.id);
      if (kind === 'delete' || !matchesListParams(party, query)) return withoutParty;
      return [party, ...withoutParty];
    });
  }

  if (kind === 'delete') {
    queryClient.removeQueries({
      predicate: (query) =>
        (query.queryKey[0] === 'getParty' || query.queryKey[0] === 'listLedgerEntries') &&
        query.queryKey[1] === party.id &&
        hasBusinessScope(query, businessId),
    });
    return;
  }

  const detailQueries = queryClient.getQueryCache().findAll({
    predicate: (query) =>
      query.queryKey[0] === 'getParty' &&
      query.queryKey[1] === party.id &&
      hasBusinessScope(query, businessId),
  });
  for (const query of detailQueries) queryClient.setQueryData(query.queryKey, party);
}

export async function applyQueuedPartyOperations(
  queryClient: QueryClient,
  actorId: string,
  businessId: string,
): Promise<void> {
  const operations = await listPartyOperations(actorId, businessId);
  for (const operation of operations) {
    if (operation.kind === 'delete') {
      if (operation.beforeParty) applyParty(queryClient, businessId, 'delete', operation.beforeParty);
    } else if (operation.optimisticParty) {
      applyParty(queryClient, businessId, operation.kind, operation.optimisticParty);
    }
  }
}

function statusFrom(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  const status = (error as { status?: unknown }).status ?? response?.status;
  return typeof status === 'number' ? status : undefined;
}

function transientFailure(error: unknown): boolean {
  const status = statusFrom(error);
  if (status !== undefined) return status === 0 || status >= 500;
  const message = error instanceof Error ? error.message : '';
  return /network|fetch|offline|timeout|timed out|connection/i.test(message);
}

function rejectionMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 400);
  return 'The change was rejected by the server and is still saved on this device.';
}

async function replayOperation(
  operation: QueuedPartyOperation,
  mode: 'upserts' | 'deletes',
): Promise<void> {
  const headers = { headers: { 'x-business-id': operation.businessId } };
  if (operation.kind === 'delete') {
    if (mode !== 'deletes') return;
    const pendingEntries = await listEntries(operation.actorId, operation.businessId);
    if (pendingEntries.some((entry) => entry.partyId === operation.partyId)) return;
    try {
      await deleteParty(operation.partyId, headers);
    } catch (error) {
      if (statusFrom(error) !== 404) throw error;
    }
    return;
  }
  if (mode !== 'upserts') return;
  if (operation.kind === 'create' && operation.data) {
    await createParty(operation.data as PartyInput, headers);
    return;
  }
  if (operation.kind === 'update' && operation.data) {
    if (operation.beforeParty) {
      const latest = await getParty(operation.partyId, headers);
      if (latest.name !== operation.beforeParty.name || latest.phone !== operation.beforeParty.phone ||
        latest.dueDate !== operation.beforeParty.dueDate) {
        const conflict = new Error('This customer changed on another device; review the saved changes before retrying.') as Error & { status: number };
        conflict.status = 409;
        throw conflict;
      }
    }
    await updateParty(operation.partyId, operation.data as PartyUpdate, headers);
  }
}

export async function drainPartyOperations(
  actorId: string,
  businessId: string | null,
  stillCurrent: () => boolean,
  onConfirmed: (operation: QueuedPartyOperation) => void,
  mode: 'upserts' | 'deletes',
): Promise<void> {
  if (draining || !businessId || !navigator.onLine) return;
  draining = true;
  try {
    const replay = async () => {
      for (const operation of await listPartyOperations(actorId, businessId)) {
        if (!stillCurrent() || !navigator.onLine) break;
        if (operation.status === 'rejected') continue;
        if ((mode === 'upserts') !== (operation.kind !== 'delete')) continue;
        try {
          await replayOperation(operation, mode);
          if (operation.kind === 'delete' && mode === 'upserts') continue;
          await removeOperation(operation.id);
          onConfirmed(operation);
        } catch (error) {
          if (statusFrom(error) === 401 || transientFailure(error)) break;
          operation.status = 'rejected';
          operation.error = rejectionMessage(error);
          await saveOperation(operation);
          window.dispatchEvent(new CustomEvent(PARTY_OUTBOX_REJECTED, {
            detail: { partyId: operation.partyId, message: operation.error },
          }));
        }
      }
    };
    if (navigator.locks?.request) await navigator.locks.request('banglakhata-party-replay', replay);
    else await replay();
  } finally {
    draining = false;
  }
}
