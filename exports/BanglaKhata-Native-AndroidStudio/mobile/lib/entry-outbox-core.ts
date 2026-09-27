import type { LedgerEntryInput } from '@workspace/api-client-react';

export interface QueuedEntry {
  id: string;
  actorId: string;
  businessId: string;
  partyId: string;
  data: LedgerEntryInput;
  imageFile?: string;
  status: 'pending' | 'rejected';
  error?: string;
}

export interface OutboxStorage {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const outboxKey = (id: string) => `banglakhata:entry-outbox:v1:${id}`;

export async function listScopedEntries(store: OutboxStorage, actorId: string, businessId: string): Promise<QueuedEntry[]> {
  const keys = (await store.getAllKeys()).filter((key) => key.startsWith('banglakhata:entry-outbox:v1:'));
  if (!keys.length) return [];
  const values = await store.multiGet(keys);
  return values.flatMap(([, raw]) => {
    if (!raw) return [];
    const value = JSON.parse(raw) as QueuedEntry;
    return value.actorId === actorId && value.businessId === businessId ? [value] : [];
  });
}

let replaying = false;

/** Preserve a denied draft, but retry ambiguous network errors with the exact same UUID. */
export async function replayScopedEntries(
  store: OutboxStorage,
  actorId: string,
  businessId: string,
  stillCurrent: () => boolean,
  deliver: (entry: QueuedEntry) => Promise<void>,
  onConfirmed: (entry: QueuedEntry) => Promise<void> | void,
  onChanged: () => void,
) {
  if (replaying) return;
  replaying = true;
  try {
    for (const entry of await listScopedEntries(store, actorId, businessId)) {
      if (!stillCurrent()) break;
      if (entry.status === 'rejected') continue;
      try {
        await deliver(entry);
        await store.removeItem(outboxKey(entry.id));
        onChanged();
        await onConfirmed(entry);
      } catch (cause) {
        const status = (cause as { status?: number })?.status;
        if (status === 401) break;
        if (status === 400 || status === 403 || status === 404 || status === 409 || status === 422) {
          entry.status = 'rejected';
          entry.error = status === 422
            ? 'সংরক্ষিত বিলের ছবি পাওয়া যাচ্ছে না। খসড়া রয়ে গেছে।'
            : 'অনুমতি নেই বা তথ্য আর উপলব্ধ নেই। খসড়া মুছে ফেলা হয়নি।';
          await store.setItem(outboxKey(entry.id), JSON.stringify(entry));
          onChanged();
          continue;
        }
        break;
      }
    }
  } finally {
    replaying = false;
  }
}