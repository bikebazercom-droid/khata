import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScopedEntries, outboxKey, replayScopedEntries } from './entry-outbox-core.ts';

function storage() {
  const items = new Map();
  return {
    items,
    async getAllKeys() { return [...items.keys()]; },
    async multiGet(keys) { return keys.map((key) => [key, items.get(key) ?? null]); },
    async setItem(key, value) { items.set(key, value); },
    async removeItem(key) { items.delete(key); },
  };
}

function draft(id, actorId = 'staff-A', businessId = 'business-A') {
  return { id, actorId, businessId, partyId: 'source',
    data: { type: 'YOU_GAVE', amount: 24, isTransfer: true, transferPartyId: 'target' },
    status: 'pending' };
}

test('native persisted drafts survive reload, retain UUID on response loss, and isolate actors/businesses', async () => {
  const store = storage();
  for (const item of [{ ...draft('request-1'), imageFile: 'file:///app/documents/queued-bill-request-1.jpg' },
    draft('request-2', 'staff-B'), draft('request-3', 'staff-A', 'business-B')]) {
    await store.setItem(outboxKey(item.id), JSON.stringify(item));
  }
  const delivered = [];
  let fail = true;
  const send = async (entry) => {
    delivered.push({ id: entry.id, ...entry.data });
    if (fail) { fail = false; throw new TypeError('Response lost after server commit'); }
  };
  const sync = () => replayScopedEntries(store, 'staff-A', 'business-A', () => true,
    send, () => {}, () => {});
  await sync();
  assert.deepEqual((await listScopedEntries(store, 'staff-A', 'business-A')).map((e) => e.id), ['request-1']);
  assert.equal((await listScopedEntries(store, 'staff-A', 'business-A'))[0].imageFile,
    'file:///app/documents/queued-bill-request-1.jpg');
  // Construct another runner as on app reload; the on-disk store is unchanged.
  await sync();
  assert.deepEqual(delivered.map((entry) => entry.id), ['request-1', 'request-1']);
  assert.equal(delivered[1].transferPartyId, 'target');
  assert.deepEqual(await listScopedEntries(store, 'staff-A', 'business-A'), []);
  assert.equal((await listScopedEntries(store, 'staff-B', 'business-A')).length, 1);
  assert.equal((await listScopedEntries(store, 'staff-A', 'business-B')).length, 1);
});

test('permission denial remains visible and never auto-retries', async () => {
  const store = storage();
  await store.setItem(outboxKey('denied'), JSON.stringify(draft('denied')));
  let calls = 0;
  const sync = () => replayScopedEntries(store, 'staff-A', 'business-A', () => true,
    async () => { calls++; throw Object.assign(new Error('Forbidden'), { status: 403 }); }, () => {}, () => {});
  await sync();
  await sync();
  assert.equal(calls, 1);
  const [item] = await listScopedEntries(store, 'staff-A', 'business-A');
  assert.equal(item.status, 'rejected');
  assert.match(item.error, /খসড়া/);
});