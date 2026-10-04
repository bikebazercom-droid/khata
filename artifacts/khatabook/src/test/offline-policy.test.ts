import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { persistCache } from '../lib/queryPersister';

describe('retired browser ledger snapshots', () => {
  beforeEach(() => localStorage.clear());

  it('keeps old local data untouched and does not write new query snapshots', async () => {
    const scopedKey = `dkhata_offline_view_v2:${encodeURIComponent(JSON.stringify(['actor', 'owner', 'business']))}`;
    const oldScopedSnapshot = JSON.stringify({ ts: 1, entries: { '["/api/parties"]': [{ id: 'old-party' }] } });
    const oldLegacySnapshot = JSON.stringify({ entries: { '["/api/parties"]': [{ id: 'legacy-party' }] } });
    const oldOfflineIdentity = JSON.stringify({ userId: 'old-actor', businessId: 'old-business' });
    localStorage.setItem(scopedKey, oldScopedSnapshot);
    localStorage.setItem('dkhata_qcache_v1', oldLegacySnapshot);
    localStorage.setItem('dkhata_offline_identity_v2', oldOfflineIdentity);

    const queryClient = new QueryClient();
    const unsubscribe = persistCache(queryClient);
    const result = await queryClient.fetchQuery({
      queryKey: ['/api/parties'],
      queryFn: async () => [{ id: 'live-party' }],
    });

    expect(result).toEqual([{ id: 'live-party' }]);
    expect(localStorage.getItem(scopedKey)).toBe(oldScopedSnapshot);
    expect(localStorage.getItem('dkhata_qcache_v1')).toBe(oldLegacySnapshot);
    expect(localStorage.getItem('dkhata_offline_identity_v2')).toBe(oldOfflineIdentity);
    expect(localStorage.length).toBe(3);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)))
      .toEqual(expect.arrayContaining([scopedKey, 'dkhata_qcache_v1', 'dkhata_offline_identity_v2']));

    unsubscribe();
    queryClient.clear();
  });
});