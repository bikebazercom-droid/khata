import { describe, expect, it } from 'vitest';
import { LedgerEntryType, PartyRole, type LedgerEntry, type Party } from '@workspace/api-client-react';
import type { QueuedEntry } from '@/lib/entryOutbox';
import { mergeLedgerEntries, projectPartyBalance } from '@/lib/offline-ledger-projection';

const party: Party = {
  id: 'party-1',
  name: 'Rahim',
  phone: '',
  role: PartyRole.CUSTOMER,
  currentBalance: 500,
  balanceType: 'YOU_WILL_GET',
  dueDate: null,
  lastTransactionAt: null,
  createdAt: '2026-10-10T00:00:00.000Z',
};

function queued(id: string, type: LedgerEntryType, amount: number): QueuedEntry {
  return {
    id,
    actorId: 'actor-1',
    businessId: 'business-1',
    partyId: party.id,
    data: { type, amount, description: `entry ${id}` },
    createdAt: '2026-10-10T01:00:00.000Z',
    status: 'pending',
  };
}

describe('offline ledger projection', () => {
  it('merges queued transactions into the normal ledger-entry shape', () => {
    const saved: LedgerEntry = {
      id: 'saved-1',
      partyId: party.id,
      type: LedgerEntryType.YOU_GOT,
      amount: 100,
      description: '',
      billReference: null,
      billImage: null,
      dueDate: null,
      createdAt: '2026-10-09T00:00:00.000Z',
    };

    expect(mergeLedgerEntries([saved], [queued('offline-1', LedgerEntryType.YOU_GAVE, 250)])).toEqual([
      saved,
      expect.objectContaining({
        id: 'offline-1',
        partyId: party.id,
        amount: 250,
        type: LedgerEntryType.YOU_GAVE,
        description: 'entry offline-1',
        isTransfer: false,
      }),
    ]);
  });

  it('projects queued debit and credit amounts into the local balance without mutating server data', () => {
    const projected = projectPartyBalance(party, [
      queued('debit', LedgerEntryType.YOU_GAVE, 300),
      queued('credit', LedgerEntryType.YOU_GOT, 50),
    ]);

    expect(projected.currentBalance).toBe(750);
    expect(projected.balanceType).toBe('YOU_WILL_GET');
    expect(party.currentBalance).toBe(500);
  });

  it('switches the displayed balance direction when queued entries cross zero', () => {
    const projected = projectPartyBalance(party, [
      queued('debit', LedgerEntryType.YOU_GOT, 800),
    ]);
    expect(projected.currentBalance).toBe(300);
    expect(projected.balanceType).toBe('YOU_WILL_GIVE');
  });
});
