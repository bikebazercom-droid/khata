import { describe, expect, it } from 'vitest';
import { resolveAuthorizedBusiness } from '@/lib/businessSelection';

const businesses = [
  { id: 'business-a', name: 'A', createdAt: '2026-10-03T00:00:00.000Z', partyCount: 2 },
  { id: 'business-b', name: 'B', createdAt: '2026-10-03T00:00:00.000Z', partyCount: 1 },
];

describe('resolveAuthorizedBusiness', () => {
  it('keeps a saved selection only if the signed-in user still has access', () => {
    expect(resolveAuthorizedBusiness(businesses, 'business-b', 'business-a')?.id).toBe('business-b');
    expect(resolveAuthorizedBusiness(businesses, 'business-from-another-account', 'business-a')?.id).toBe('business-a');
  });

  it('uses the first authorized business if the default is not in the returned membership list', () => {
    expect(resolveAuthorizedBusiness(businesses, null, 'missing-default')?.id).toBe('business-a');
  });

  it('returns null when the account has no selectable businesses', () => {
    expect(resolveAuthorizedBusiness([], 'business-a', 'business-a')).toBeNull();
  });
});