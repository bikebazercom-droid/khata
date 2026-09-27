import test from 'node:test';
import assert from 'node:assert/strict';
import { submitEntryDirectly } from './live-entry-submit-core.ts';

const request = {
  partyId: 'party-1',
  businessId: 'business-1',
  clientRequestId: 'e11b0c77-286f-48b5-92e5-d93e512eab9d',
  data: { type: 'YOU_GAVE', amount: 125 },
};

test('refuses offline entry without local persistence or upload', async () => {
  const calls = [];
  await assert.rejects(
    submitEntryDirectly(request, {
      async canReachServer() { calls.push('connectivity'); return false; },
      async uploadBill() { calls.push('upload'); return '/objects/a'; },
      async createEntry() { calls.push('create'); return {}; },
    }),
    /সার্ভারে জমা হয়নি/,
  );
  assert.deepEqual(calls, ['connectivity']);
});

test('sends a connected entry directly with its stable request id', async () => {
  const calls = [];
  const result = { id: 'entry-1' };
  const response = await submitEntryDirectly(request, {
    async canReachServer() { calls.push('connectivity'); return true; },
    async uploadBill() { calls.push('unexpected upload'); return '/objects/a'; },
    async createEntry(partyId, data, businessId) {
      calls.push({ partyId, data, businessId });
      return result;
    },
  });
  assert.equal(response, result);
  assert.deepEqual(calls, [
    'connectivity',
    { partyId: 'party-1', data: { type: 'YOU_GAVE', amount: 125, clientRequestId: request.clientRequestId }, businessId: 'business-1' },
  ]);
});

test('uploads a selected photo before submitting its object path to the server', async () => {
  const calls = [];
  await submitEntryDirectly({ ...request, imageUri: 'file://selected-photo.jpg' }, {
    async canReachServer() { return true; },
    async uploadBill(uri, businessId) { calls.push(['upload', uri, businessId]); return '/objects/bill-1'; },
    async createEntry(partyId, data, businessId) { calls.push(['create', partyId, data, businessId]); return {}; },
  });
  assert.deepEqual(calls, [
    ['upload', 'file://selected-photo.jpg', 'business-1'],
    ['create', 'party-1', { type: 'YOU_GAVE', amount: 125, clientRequestId: request.clientRequestId, billImage: '/objects/bill-1' }, 'business-1'],
  ]);
});