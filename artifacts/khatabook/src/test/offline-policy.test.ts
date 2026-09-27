import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { clearOfflineIdentity, readOfflineIdentity, writeOfflineIdentity } from '../lib/authCache';
import { clearActorViews, getOfflineEntries, permittedQueryKey, persistCache, setPersistedScope } from '../lib/queryPersister';

describe('offline private view', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });

  it('never persists API auth/admin/object responses or arbitrary queries', () => {
    for (const key of ['/api/auth/me', '/api/admin/users', '/api/objects/a', 'auth-me', '/api/user/account']) {
      expect(permittedQueryKey([key])).toBe(false);
    }
    expect(permittedQueryKey(['/api/parties/abc/ledger-entries'])).toBe(true);
  });

  it('partitions actor, role and business, dropping legacy unscoped data', async () => {
    const qc = new QueryClient();
    localStorage.setItem('dkhata_qcache_v1', JSON.stringify({ entries: { token: 'secret' } }));
    const unsubscribe = persistCache(qc);
    setPersistedScope(qc, 'actor-1', 'owner', 'business-1');
    await qc.fetchQuery({ queryKey: ['/api/parties'], queryFn: async () => [{ id: 'one', name: 'Private' }] });
    qc.setQueryData(['/api/auth/me'], { token: 'secret' });
    vi.advanceTimersByTime(300);
    expect(getOfflineEntries('actor-1', 'owner', 'business-1')).toHaveProperty('["/api/parties"]');
    expect(getOfflineEntries('actor-2', 'owner', 'business-1')).toEqual({});
    expect(getOfflineEntries('actor-1', 'staff', 'business-1')).toEqual({});
    expect(getOfflineEntries('actor-1', 'owner', 'business-2')).toEqual({});
    expect(localStorage.getItem('dkhata_qcache_v1')).toBeNull();
    clearActorViews('actor-1');
    expect(getOfflineEntries('actor-1', 'owner', 'business-1')).toEqual({});
    unsubscribe();
  });

  it('stores verified identity without credentials and revokes offline view at logout', () => {
    writeOfflineIdentity({ userId: 'actor', businessId: 'biz', role: 'staff', authMethod: 'phone', phone: '123' });
    expect(readOfflineIdentity()).toMatchObject({ userId: 'actor', role: 'staff', permittedBusinessIds: ['biz'] });
    expect(JSON.stringify(readOfflineIdentity())).not.toContain('123');
    clearOfflineIdentity();
    expect(readOfflineIdentity()).toBeNull();
  });
});