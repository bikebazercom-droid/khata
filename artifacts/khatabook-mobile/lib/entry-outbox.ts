import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { createLedgerEntry } from '@workspace/api-client-react';
import { customFetch } from './api-transport';
import { listScopedEntries, outboxKey, replayScopedEntries, type QueuedEntry } from './entry-outbox-core';
export type { QueuedEntry } from './entry-outbox-core';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
export function subscribeOutbox(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const key = outboxKey;

export async function listEntries(actorId: string, businessId: string): Promise<QueuedEntry[]> {
  return listScopedEntries(AsyncStorage, actorId, businessId);
}

export async function queueEntry(entry: QueuedEntry, imageUri?: string): Promise<void> {
  let imageFile: string | undefined;
  if (imageUri) {
    if (!FileSystem.documentDirectory) throw new Error('Persistent photo storage unavailable');
    imageFile = `${FileSystem.documentDirectory}queued-bill-${entry.id}.jpg`;
    await FileSystem.copyAsync({ from: imageUri, to: imageFile });
  }
  try {
    await AsyncStorage.setItem(key(entry.id), JSON.stringify({ ...entry, imageFile }));
  } catch (error) {
    if (imageFile) await FileSystem.deleteAsync(imageFile, { idempotent: true }).catch(() => {});
    throw error;
  }
  notify();
}

/** Replays only the currently authenticated account and business. */
export async function drainEntries(
  actorId: string, businessId: string, stillCurrent: () => boolean,
  onConfirmed: () => void,
) {
  await replayScopedEntries(AsyncStorage, actorId, businessId, stillCurrent,
    async (entry) => {
        if (entry.imageFile && !entry.data.billImage) {
          const file = await FileSystem.getInfoAsync(entry.imageFile);
          if (!file.exists) {
            throw Object.assign(new Error('Bill photo missing'), { status: 422 });
          }
          const blob = await (await fetch(entry.imageFile)).blob();
          const meta = await customFetch<{ uploadURL: string; objectPath: string }>('/api/storage/uploads/request-url', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-business-id': businessId },
            body: JSON.stringify({ name: 'bill.jpg', size: blob.size, contentType: blob.type || 'image/jpeg' }),
          });
          const uploaded = await fetch(meta.uploadURL, { method: 'PUT', body: blob,
            headers: { 'Content-Type': blob.type || 'image/jpeg' } });
          if (!uploaded.ok) throw new Error(`Bill upload failed: ${uploaded.status}`);
          entry.data.billImage = meta.objectPath;
          await AsyncStorage.setItem(key(entry.id), JSON.stringify(entry));
          notify();
        }
        if (!stillCurrent()) throw new Error('Account changed');
        // Generated client uses the configured Clerk/phone token getter.
        // The token is never included in the AsyncStorage draft.
        await createLedgerEntry(entry.partyId, { ...entry.data, clientRequestId: entry.id },
          { headers: { 'x-business-id': businessId } });
    },
    async (entry) => {
        if (entry.imageFile) await FileSystem.deleteAsync(entry.imageFile, { idempotent: true }).catch(() => {});
        onConfirmed();
    }, notify);
}