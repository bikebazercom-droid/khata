import { createLedgerEntry, type LedgerEntryInput } from '@workspace/api-client-react';
import { uploadBillImage } from './billImageStorage';

/** Entries are drafts until the server acknowledges their idempotent request. */
export interface QueuedEntry {
  id: string;
  actorId: string;
  businessId: string | null;
  partyId: string;
  data: LedgerEntryInput;
  imageBase64?: string;
  serverEntryId?: string;
  linkedServerEntryId?: string;
  createdAt: string;
  status: 'pending' | 'rejected';
  error?: string;
}

const DB_NAME = 'banglakhata-entry-outbox';
const STORE = 'entries';
export const ENTRY_OUTBOX_CHANGED = 'banglakhata-entry-outbox-changed';
let dbPromise: Promise<IDBDatabase> | undefined;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Offline storage unavailable'));
      request.onblocked = () => reject(new Error('Offline storage is blocked by another tab'));
    }).catch((error) => {
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    let value: T;
    request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error ?? new Error('Could not save offline draft'));
    tx.onabort = () => reject(tx.error ?? new Error('Offline draft transaction aborted'));
  });
}

function changed() {
  window.dispatchEvent(new Event(ENTRY_OUTBOX_CHANGED));
}

export async function queueEntry(entry: QueuedEntry): Promise<void> {
  await transaction('readwrite', (store) => store.add(entry));
  changed();
}

export async function listEntries(actorId: string, businessId: string | null): Promise<QueuedEntry[]> {
  const all = await transaction<QueuedEntry[]>('readonly', (store) => store.getAll());
  return all.filter((entry) => entry.actorId === actorId && entry.businessId === businessId);
}

const REJECTION_FALLBACK = 'অনুমতি নেই বা তথ্য আর উপলভ্য নেই। খসড়াটি সংরক্ষিত আছে।';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function rejectionReason(error: unknown): string {
  if (!isRecord(error)) return REJECTION_FALLBACK;
  const response = isRecord(error.response) ? error.response : null;
  const payload = isRecord(error.data)
    ? error.data
    : response && isRecord(response.data)
      ? response.data
      : null;

  if (payload) {
    for (const key of ['detail', 'message', 'error_description', 'error', 'title']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
    }
  } else if (typeof error.data === 'string' && error.data.trim()) {
    return error.data.trim().slice(0, 500);
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    const message = error.message.trim();
    const withoutHttpPrefix = message.replace(/^HTTP\s+\d{3}(?:\s+[^:]+)?\s*:?\s*/i, '').trim();
    if (withoutHttpPrefix && !/^HTTP\s+\d{3}\b/i.test(withoutHttpPrefix)) {
      return withoutHttpPrefix.slice(0, 500);
    }
  }
  return REJECTION_FALLBACK;
}

/** Rejected drafts only; optionally include legacy unscoped drafts for their verified business. */
export async function listRejectedEntries(
  actorId: string,
  businessId: string,
  includeLegacyUnscoped = false,
): Promise<QueuedEntry[]> {
  const entries = await listEntries(actorId, businessId);
  if (includeLegacyUnscoped) entries.push(...await listEntries(actorId, null));
  return entries.filter((entry) => entry.status === 'rejected');
}

/** Remove a rejected draft only when it still belongs to the current actor and business. */
export async function discardRejectedEntry(
  id: string,
  actorId: string,
  businessId: string,
  includeLegacyUnscoped = false,
): Promise<boolean> {
  const entry = await transaction<QueuedEntry | undefined>('readonly', (store) => store.get(id));
  const belongsToBusiness = entry?.businessId === businessId ||
    (includeLegacyUnscoped && entry?.businessId === null);
  if (!entry || entry.actorId !== actorId || entry.status !== 'rejected' || !belongsToBusiness) {
    return false;
  }
  await removeEntry(id);
  return true;
}

async function updateEntry(entry: QueuedEntry) {
  await transaction('readwrite', (store) => store.put(entry));
  changed();
}

async function removeEntry(id: string) {
  await transaction('readwrite', (store) => store.delete(id));
  changed();
}

let draining = false;
let pendingDrain: {
  actorId: string;
  businessId: string | null;
  stillCurrent: () => boolean;
  onConfirmed: (entry: QueuedEntry) => void;
} | null = null;

/** Only this authenticated actor and this business may replay these drafts. */
export async function drainEntries(
  actorId: string,
  businessId: string | null,
  stillCurrent: () => boolean,
  onConfirmed: (entry: QueuedEntry) => void,
): Promise<void> {
  if (!navigator.onLine) return;
  if (draining) {
    pendingDrain = { actorId, businessId, stillCurrent, onConfirmed };
    return;
  }
  draining = true;
  try {
    const replay = async () => {
      // Re-read after acquiring the lock: another tab may have confirmed and
      // removed an entry while this tab was waiting.
      const entries = await listEntries(actorId, businessId);
      for (const entry of entries) {
        if (!stillCurrent() || !navigator.onLine) break;
        if (entry.status === 'rejected') continue;
        try {
          let billImage = entry.data.billImage;
          if (entry.imageBase64 && !billImage) {
            const uploaded = await uploadBillImage(entry.imageBase64);
            if (!uploaded.ok) break;
            billImage = uploaded.objectPath;
            entry.data = { ...entry.data, billImage };
            await updateEntry(entry);
          }
          if (!stillCurrent()) break;
          const serverEntry = await createLedgerEntry(entry.partyId, {
            ...entry.data,
            clientRequestId: entry.id,
          }, {
            headers: { 'x-business-id': businessId ?? '' },
          });
          entry.serverEntryId = serverEntry.id;
          entry.linkedServerEntryId = serverEntry.linkedEntryId ?? undefined;
          await updateEntry(entry);
          await removeEntry(entry.id);
          onConfirmed(entry);
        } catch (error) {
          // A denied request is not a transient network error. Keep the full draft
          // visible for review; never retry it with a different user's credentials.
          const status = (error as { status?: number })?.status;
          if (status === 401) break;
          // The draft is already visible because creates are local-first, but
          // an HTTP response is still a server decision—not an offline signal.
          // Preserve and surface all non-retryable 4xx/5xx responses instead
          // of leaving them looking as though they are merely waiting for
          // connectivity. Keep standard throttling/timeout responses retryable.
          if (
            typeof status === 'number' &&
            status >= 400 &&
            status <= 599 &&
            status !== 408 &&
            status !== 425 &&
            status !== 429
          ) {
            entry.status = 'rejected';
            entry.error = rejectionReason(error);
            await updateEntry(entry);
            continue;
          }
          break;
        }
      }
    };
    // A single browser may have several open tabs with independent JS modules.
    // Serialize photo upload + receipt submission across those tabs. PostgreSQL
    // still enforces uniqueness if the browser lacks the Web Locks API.
    if (navigator.locks?.request) await navigator.locks.request('banglakhata-entry-replay', replay);
    else await replay();
  } finally {
    draining = false;
    const queuedDrain = pendingDrain;
    pendingDrain = null;
    if (queuedDrain) {
      void drainEntries(
        queuedDrain.actorId,
        queuedDrain.businessId,
        queuedDrain.stillCurrent,
        queuedDrain.onConfirmed,
      );
    }
  }
}