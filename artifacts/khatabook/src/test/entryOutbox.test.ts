import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerEntryType } from '@workspace/api-client-react';

const send = vi.fn();
vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ...original, createLedgerEntry: (...args: unknown[]) => send(...args) };
});
vi.mock('@/lib/billImageStorage', () => ({
  uploadBillImage: vi.fn(async () => ({ ok: true, objectPath: '/objects/uploads/test' })),
}));

// Tiny transactional IndexedDB stand-in: changes survive module re-import.
const records = new Map<string, unknown>();
const storage = {
  transaction: () => {
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: Error } = {};
    const store = {
      add(value: { id: string }) { records.set(value.id, structuredClone(value)); return request(undefined); },
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
    return { ...tx, objectStore: () => store, get oncomplete() { return tx.oncomplete; }, set oncomplete(fn: () => void) { tx.oncomplete = fn; } };
  },
};

beforeEach(() => {
  records.clear();
  send.mockReset();
  vi.resetModules();
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: { result: typeof storage; onsuccess?: () => void } = { result: storage };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

const draft = (id: string, actorId = 'staff-A', businessId: string | null = 'business-A') => ({
  id, actorId, businessId, partyId: 'source',
  data: { type: LedgerEntryType.YOU_GAVE, amount: 100, isTransfer: true, transferPartyId: 'target' },
  createdAt: new Date().toISOString(), status: 'pending' as const,
});

describe('persistent entry outbox', () => {
  it('keeps the same request id after reload and ambiguous response loss, and never replays another actor or business', async () => {
    const first = await import('@/lib/entryOutbox');
    await first.queueEntry(draft('request-1'));
    await first.queueEntry(draft('request-2', 'staff-B'));
    await first.queueEntry(draft('request-3', 'staff-A', 'business-B'));
    send.mockRejectedValueOnce(new TypeError('connection reset after commit')).mockResolvedValue({ id: 'saved' });
    await first.drainEntries('staff-A', 'business-A', () => true, () => {});
    expect((await first.listEntries('staff-A', 'business-A')).map((item) => item.id)).toEqual(['request-1']);
    // A new module instance reads the same persistent storage, not a JS memory queue.
    vi.resetModules();
    const restored = await import('@/lib/entryOutbox');
    const confirmed = vi.fn();
    await restored.drainEntries('staff-A', 'business-A', () => true, confirmed);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1].clientRequestId).toBe('request-1');
    expect(send.mock.calls[1][1].clientRequestId).toBe('request-1');
    expect(send.mock.calls[1][1].transferPartyId).toBe('target');
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(await restored.listEntries('staff-A', 'business-A')).toEqual([]);
    expect(await restored.listEntries('staff-B', 'business-A')).toHaveLength(1);
  });

  it('retains a denied draft and does not retry it automatically', async () => {
    const outbox = await import('@/lib/entryOutbox');
    await outbox.queueEntry(draft('request-denied'));
    send.mockRejectedValue({ status: 403 });
    await outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    await outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    expect(send).toHaveBeenCalledTimes(1);
    expect((await outbox.listEntries('staff-A', 'business-A'))[0].status).toBe('rejected');
  });

  it('stores a bill image with its draft and sends only a cloud object path after replay', async () => {
    const outbox = await import('@/lib/entryOutbox');
    await outbox.queueEntry({ ...draft('request-with-image'), imageBase64: 'data:image/jpeg;base64,YWJj' });
    vi.resetModules();
    const restored = await import('@/lib/entryOutbox');
    send.mockResolvedValue({ id: 'saved' });
    await restored.drainEntries('staff-A', 'business-A', () => true, () => {});
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].billImage).toBe('/objects/uploads/test');
    expect(JSON.stringify(send.mock.calls[0][1])).not.toContain('base64');
    expect(await restored.listEntries('staff-A', 'business-A')).toEqual([]);
  });
});