import { describe, expect, it } from 'vitest';
import type { Party } from '@workspace/api-client-react';
import { sortPartiesByRecentActivity } from './party-activity';

function party(id: string, createdAt: string, lastTransactionAt: string | null): Party {
  return {
    id,
    name: id,
    phone: '',
    role: 'CUSTOMER',
    createdAt,
    lastTransactionAt,
  } as unknown as Party;
}

describe('party activity sorting', () => {
  it('puts a recent transaction first and uses creation time for parties without transactions', () => {
    const parties = [
      party('older-activity', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'),
      party('new-party', '2026-01-05T00:00:00Z', null),
      party('recent-activity', '2025-01-01T00:00:00Z', '2026-01-06T00:00:00Z'),
    ];

    expect(sortPartiesByRecentActivity(parties).map(({ id }) => id))
      .toEqual(['recent-activity', 'new-party', 'older-activity']);
    expect(sortPartiesByRecentActivity(parties, 'oldest').map(({ id }) => id))
      .toEqual(['older-activity', 'new-party', 'recent-activity']);
  });
});
