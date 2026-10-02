import { describe, expect, it } from 'vitest';
import { businessScopedQueryKey } from '@/lib/businessQueryKey';

describe('businessScopedQueryKey', () => {
  it('keeps the same API query separate for different khatas', () => {
    const key = ['/api/parties', { role: 'CUSTOMER' }] as const;

    expect(businessScopedQueryKey(key, 'khata-a'))
      .not.toEqual(businessScopedQueryKey(key, 'khata-b'));
  });

  it('returns a stable key for the same khata', () => {
    const key = ['/api/parties', { role: 'CUSTOMER' }] as const;

    expect(businessScopedQueryKey(key, 'khata-a'))
      .toEqual(businessScopedQueryKey(key, 'khata-a'));
  });
});