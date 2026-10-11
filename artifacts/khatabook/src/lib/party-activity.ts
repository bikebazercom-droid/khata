import type { Party } from '@workspace/api-client-react';

export function getPartyActivityTime(party: Pick<Party, 'lastTransactionAt' | 'createdAt'>): number {
  const value = party.lastTransactionAt ?? party.createdAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function sortPartiesByRecentActivity(parties: Party[], direction: 'recent' | 'oldest' = 'recent'): Party[] {
  const factor = direction === 'recent' ? -1 : 1;
  return [...parties].sort((a, b) =>
    factor * (getPartyActivityTime(a) - getPartyActivityTime(b)) ||
    a.name.localeCompare(b.name, 'bn'),
  );
}
