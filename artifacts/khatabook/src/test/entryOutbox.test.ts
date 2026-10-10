import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerEntryType } from '@workspace/api-client-react';

const send = vi.fn();
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent<{ type?: string }>) => void) | null = null;
  readonly messages: unknown[] = [];
  constructor(readonly name: string) {
    MockBroadcastChannel.instances.push(this);
  }
  postMessage(message: unknown) { this.messages.push(message); }
}

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
      get(id: string) { return request(records.has(id) ? structuredClone(records.get(id)) : undefined); },
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  records.clear();
  MockBroadcastChannel.instances = [];
  send.mockReset();
  vi.resetModules();
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: { result: typeof storage; onsuccess?: () => void } = { result: storage };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  });
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

const draft = (id: string, actorId = 'staff-A', businessId: string | null = 'business-A') => ({
  id, actorId, businessId, partyId: 'source',
  data: { type: LedgerEntryType.YOU_GAVE, amount: 100, isTransfer: true, transferPartyId: 'target' },
  createdAt: new Date().toISOString(), status: 'pending' as const,
});

describe('persistent entry outbox', () => {
  it('uses storage pulses for queue, rejection, and removal when BroadcastChannel is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    localStorage.removeItem('banglakhata-entry-outbox-change-pulse');
    const outbox = await import('@/lib/entryOutbox');
    await outbox.queueEntry(draft('other-tab-scope', 'staff-B'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const changes = vi.fn();
    let lastScopedIds: string[] = [];
    const refreshScope = () => {
      void outbox.listEntries('staff-A', 'business-A').then((entries) => {
        lastScopedIds = entries.map((entry) => entry.id);
      });
    };
    window.addEventListener(outbox.ENTRY_OUTBOX_CHANGED, changes);
    window.addEventListener(outbox.ENTRY_OUTBOX_CHANGED, refreshScope);
    await outbox.listEntries('staff-A', 'business-A');

    await outbox.queueEntry(draft('fallback-rejection'));
    expect(setItem).toHaveBeenCalledWith(
      'banglakhata-entry-outbox-change-pulse',
      expect.any(String),
    );
    expect(changes).toHaveBeenCalledTimes(1);

    send.mockRejectedValue({ status: 403, data: { error: 'not allowed' } });
    await outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    expect(changes).toHaveBeenCalledTimes(2);
    const pulse = localStorage.getItem('banglakhata-entry-outbox-change-pulse');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'banglakhata-entry-outbox-change-pulse',
      newValue: `${pulse}-remote`,
    }));
    expect(changes).toHaveBeenCalledTimes(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lastScopedIds).toEqual(['fallback-rejection']);

    expect(await outbox.discardRejectedEntry('fallback-rejection', 'staff-A', 'business-A')).toBe(true);
    expect(changes).toHaveBeenCalledTimes(4);
    expect(setItem).toHaveBeenCalledTimes(3);
    window.removeEventListener(outbox.ENTRY_OUTBOX_CHANGED, changes);
    window.removeEventListener(outbox.ENTRY_OUTBOX_CHANGED, refreshScope);
  });

  it('keeps same-tab outbox updates working when storage access is blocked', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });
    const outbox = await import('@/lib/entryOutbox');
    const changes = vi.fn();
    window.addEventListener(outbox.ENTRY_OUTBOX_CHANGED, changes);
    await outbox.queueEntry(draft('storage-blocked'));

    expect(changes).toHaveBeenCalledTimes(1);
    expect(await outbox.listEntries('staff-A', 'business-A')).toHaveLength(1);
    window.removeEventListener(outbox.ENTRY_OUTBOX_CHANGED, changes);
  });

  it('broadcasts entry changes so another open tab refreshes its scoped outbox view', async () => {
    const outbox = await import('@/lib/entryOutbox');
    const changed = vi.fn();
    window.addEventListener(outbox.ENTRY_OUTBOX_CHANGED, changed);
    await outbox.listEntries('staff-A', 'business-A');
    const channel = MockBroadcastChannel.instances.find((item) => item.name === 'banglakhata-entry-outbox-changes');

    expect(channel).toBeDefined();
    await outbox.queueEntry(draft('cross-tab-entry'));
    expect(channel?.messages).toEqual([{ type: 'changed' }]);
    expect(changed).toHaveBeenCalledTimes(1);

    channel?.onmessage?.({ data: { type: 'changed' } } as MessageEvent<{ type?: string }>);
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(outbox.ENTRY_OUTBOX_CHANGED, changed);
  });

  it('keeps the same request id after reload and ambiguous response loss, and never replays another actor or business', async () => {
    const first = await import('@/lib/entryOutbox');
    await first.queueEntry(draft('request-1'));
    await first.queueEntry(draft('request-2', 'staff-B'));
    await first.queueEntry(draft('request-3', 'staff-A', 'business-B'));
    send.mockRejectedValueOnce(new TypeError('connection reset after commit'))
      .mockResolvedValue({ id: 'saved', linkedEntryId: 'saved-counterpart' });
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
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({
      serverEntryId: 'saved',
      linkedServerEntryId: 'saved-counterpart',
    }));
    expect(await restored.listEntries('staff-A', 'business-A')).toEqual([]);
    expect(await restored.listEntries('staff-B', 'business-A')).toHaveLength(1);
  });

  it.each([400, 403, 404, 409, 422, 500, 503])('retains the server reason for rejected status %i and does not retry it', async (status) => {
    const outbox = await import('@/lib/entryOutbox');
    await outbox.queueEntry(draft('request-denied'));
    send.mockRejectedValue({ status, data: { error: 'স্টাফের এই হিসাবে প্রবেশাধিকার নেই।' } });
    await outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    await outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    expect(send).toHaveBeenCalledTimes(1);
    const [rejected] = await outbox.listRejectedEntries('staff-A', 'business-A');
    expect(rejected.status).toBe('rejected');
    expect(rejected.error).toBe('স্টাফের এই হিসাবে প্রবেশাধিকার নেই।');
  });

  it('lists rejected drafts only and discards only a confirmed draft in the matching actor and business scope', async () => {
    const outbox = await import('@/lib/entryOutbox');
    await outbox.queueEntry({ ...draft('rejected-A'), status: 'rejected', error: 'Server reason' });
    await outbox.queueEntry(draft('pending-A'));
    await outbox.queueEntry({ ...draft('rejected-B', 'staff-B'), status: 'rejected', error: 'Other actor' });
    await outbox.queueEntry({ ...draft('rejected-C', 'staff-A', 'business-B'), status: 'rejected', error: 'Other business' });
    await outbox.queueEntry({ ...draft('legacy-rejected', 'staff-A', null), status: 'rejected', error: 'Legacy reason' });

    expect((await outbox.listRejectedEntries('staff-A', 'business-A')).map((entry) => entry.id))
      .toEqual(['rejected-A']);
    expect((await outbox.listRejectedEntries('staff-A', 'business-A', true)).map((entry) => entry.id))
      .toEqual(['rejected-A', 'legacy-rejected']);

    expect(await outbox.discardRejectedEntry('pending-A', 'staff-A', 'business-A')).toBe(false);
    expect(await outbox.discardRejectedEntry('rejected-B', 'staff-A', 'business-A')).toBe(false);
    expect(await outbox.discardRejectedEntry('rejected-C', 'staff-A', 'business-A')).toBe(false);
    expect(await outbox.discardRejectedEntry('legacy-rejected', 'staff-A', 'business-A')).toBe(false);
    expect(await outbox.discardRejectedEntry('legacy-rejected', 'staff-A', 'business-A', true)).toBe(true);
    expect(await outbox.listEntries('staff-A', 'business-A')).toHaveLength(2);
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

  it('runs a queued replay request that arrives while another entry is syncing', async () => {
    const outbox = await import('@/lib/entryOutbox');
    await outbox.queueEntry(draft('request-first'));
    await outbox.queueEntry(draft('request-second'));
    let releaseFirst: ((value: { id: string }) => void) | undefined;
    send
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue({ id: 'saved' });

    const firstDrain = outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await outbox.drainEntries('staff-A', 'business-A', () => true, () => {});
    releaseFirst?.({ id: 'saved-first' });
    await firstDrain;

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      expect(await outbox.listEntries('staff-A', 'business-A')).toEqual([]);
    });
  });
});