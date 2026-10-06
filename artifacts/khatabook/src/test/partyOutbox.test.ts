import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Party, PartyInput, PartyUpdate } from '@workspace/api-client-react';

const api = vi.hoisted(() => ({
  createParty: vi.fn(),
  updateParty: vi.fn(),
  deleteParty: vi.fn(),
  getParty: vi.fn(),
}));
vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ...original, ...api };
});

const records = new Map<string, unknown>();
const storage = {
  objectStoreNames: { contains: () => true },
  transaction: () => {
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: Error } = {};
    const store = {
      put(value: { id: string }) { records.set(value.id, structuredClone(value)); return request(undefined); },
      delete(id: string) { records.delete(id); return request(undefined); },
      getAll() { return request([...records.values()].map((value) => structuredClone(value))); },
    };
    function request(result: unknown) {
      const req: { result: unknown; onsuccess?: () => void } = { result };
      queueMicrotask(() => {
        req.onsuccess?.();
        queueMicrotask(() => tx.oncomplete?.());
      });
      return req;
    }
    return {
      objectStore: () => store,
      get oncomplete() { return tx.oncomplete; },
      set oncomplete(fn: () => void) { tx.oncomplete = fn; },
      get onerror() { return tx.onerror; },
      set onerror(fn: () => void) { tx.onerror = fn; },
      get onabort() { return tx.onabort; },
      set onabort(fn: () => void) { tx.onabort = fn; },
      get error() { return tx.error; },
    };
  },
};

const customer = (name: string): Party => ({
  id: 'party-A',
  businessId: 'business-A',
  name,
  phone: '01700000000',
  role: 'CUSTOMER',
  currentBalance: 125,
  balanceType: 'YOU_WILL_GET',
  dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as Party);

beforeEach(() => {
  records.clear();
  api.createParty.mockReset().mockResolvedValue({});
  api.updateParty.mockReset().mockResolvedValue({});
  api.deleteParty.mockReset().mockResolvedValue({});
  api.getParty.mockReset();
  vi.resetModules();
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: { result: typeof storage; onsuccess?: () => void } = { result: storage };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

describe('offline customer changes', () => {
  it('coalesces edits into the queued create and restores the latest customer locally', async () => {
    const outbox = await import('../lib/partyOutbox');
    const queryClient = new QueryClient();
    const initial = customer('Old name');
    const updated = customer('New name');
    const createData = { id: initial.id, name: initial.name, phone: initial.phone, role: initial.role } as unknown as PartyInput;

    await outbox.queuePartyOperation({
      id: 'create-op',
      actorId: 'actor-A',
      businessId: 'business-A',
      partyId: initial.id,
      kind: 'create',
      data: createData,
      optimisticParty: initial,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'pending',
    });
    await outbox.queuePartyOperation({
      id: 'update-op',
      actorId: 'actor-A',
      businessId: 'business-A',
      partyId: initial.id,
      kind: 'update',
      data: { name: updated.name } as PartyUpdate,
      beforeParty: initial,
      optimisticParty: updated,
      createdAt: '2026-01-02T00:00:00.000Z',
      status: 'pending',
    });

    const operations = await outbox.listPartyOperations('actor-A', 'business-A');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: 'create-op',
      kind: 'create',
      data: { name: 'New name' },
    });

    const listKey = ['listParties', { role: 'CUSTOMER', search: '', dueFilter: 'ALL' }, { activeBusinessId: 'business-A' }];
    queryClient.setQueryData(listKey, []);
    await outbox.applyQueuedPartyOperations(queryClient, 'actor-A', 'business-A');
    expect(queryClient.getQueryData<Party[]>(listKey)?.[0]?.name).toBe('New name');

    queryClient.clear();
  });

  it('syncs an idempotent create only after the session is authorized', async () => {
    const outbox = await import('../lib/partyOutbox');
    const party = customer('New customer');
    const operation = {
      id: 'create-op',
      actorId: 'actor-A',
      businessId: 'business-A',
      partyId: party.id,
      kind: 'create' as const,
      data: { id: party.id, name: party.name, phone: party.phone, role: party.role } as unknown as PartyInput,
      optimisticParty: party,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'pending' as const,
    };
    await outbox.queuePartyOperation(operation);
    const confirmed = vi.fn();
    await outbox.drainPartyOperations('actor-A', 'business-A', () => false, confirmed, 'upserts');
    expect(api.createParty).not.toHaveBeenCalled();
    expect(await outbox.listPartyOperations('actor-A', 'business-A')).toHaveLength(1);

    await outbox.drainPartyOperations('actor-A', 'business-A', () => true, confirmed, 'upserts');
    expect(api.createParty).toHaveBeenCalledWith(operation.data, {
      headers: { 'x-business-id': 'business-A' },
    });
    expect(confirmed).toHaveBeenCalledOnce();
    expect(await outbox.listPartyOperations('actor-A', 'business-A')).toHaveLength(0);
  });
});
