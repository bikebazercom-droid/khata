import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const records = new Map<string, unknown>();
const storage = {
  objectStoreNames: { contains: () => true },
  transaction: () => {
    const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: Error } = {};
    const store = {
      put(value: { key?: string; id?: string }) {
        const key = value.key ?? value.id;
        if (key) records.set(key, structuredClone(value));
        return request(undefined);
      },
      delete(key: string) { records.delete(key); return request(undefined); },
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

beforeEach(() => {
  records.clear();
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: { result: typeof storage; onsuccess?: () => void; onupgradeneeded?: () => void } = { result: storage };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  vi.resetModules();
});

describe('offline query snapshots', () => {
  it('persists only data scoped to the matching account and business, then restores it', async () => {
    const {
      setQueryPersistenceScope: setScope,
      persistCache: attachPersister,
      restorePersistedQueries: restore,
      clearPersistedQueries: clear,
    } = await import('../lib/queryPersister');
    const queryClient = new QueryClient();
    setScope('actor-A', 'business-A');
    const unsubscribe = attachPersister(queryClient);

    queryClient.setQueryData(
      ['listParties', { role: 'CUSTOMER' }, { activeBusinessId: 'business-A' }],
      [{ id: 'party-A', name: 'Offline Customer' }],
    );
    queryClient.setQueryData(
      ['listParties', { role: 'CUSTOMER' }, { activeBusinessId: 'business-B' }],
      [{ id: 'party-B', name: 'Other Business' }],
    );
    queryClient.setQueryData(['/api/parties'], [{ id: 'legacy' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const restored = new QueryClient();
    await restore(restored, 'actor-A', 'business-A');
    expect(restored.getQueryData(['listParties', { role: 'CUSTOMER' }, { activeBusinessId: 'business-A' }]))
      .toEqual([{ id: 'party-A', name: 'Offline Customer' }]);
    expect(restored.getQueryData(['listParties', { role: 'CUSTOMER' }, { activeBusinessId: 'business-B' }]))
      .toBeUndefined();
    expect(restored.getQueryCache().getAll()).toHaveLength(1);

    const otherActor = new QueryClient();
    await restore(otherActor, 'actor-B', 'business-A');
    expect(otherActor.getQueryCache().getAll()).toHaveLength(0);

    unsubscribe();
    queryClient.clear();
    restored.clear();
    otherActor.clear();
    await clear();
  });
});
