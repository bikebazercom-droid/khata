import { describe, expect, it } from 'vitest';
import { LedgerEntryType, PartyRole, type LedgerEntry, type Party } from '@workspace/api-client-react';
import type { QueuedEntry } from '@/lib/entryOutbox';
import { mergeLedgerEntries, projectPartyBalance, queuedEntriesForParty } from '@/lib/offline-ledger-projection';

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

function queued(
  id: string,
  type: LedgerEntryType,
  amount: number,
  transferPartyId?: string,
): QueuedEntry {
  return {
    id,
    actorId: 'actor-1',
    businessId: 'business-1',
    partyId: party.id,
    data: {
      type,
      amount,
      description: `entry ${id}`,
      ...(transferPartyId ? { isTransfer: true, transferPartyId } : {}),
    },
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

    expect(mergeLedgerEntries([saved], [queued('offline-1', LedgerEntryType.YOU_GAVE, 250)], party.id)).toEqual([
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

  it('projects a transfer with opposite amounts into both parties and links the rows', () => {
    const destination: Party = { ...party, id: 'party-2', name: 'Karim', currentBalance: 1000 };
    const transfer = queued('transfer-1', LedgerEntryType.YOU_GAVE, 250, destination.id);

    const sourceRow = mergeLedgerEntries([], [transfer], party.id)[0];
    const destinationRow = mergeLedgerEntries([], [transfer], destination.id)[0];

    expect(sourceRow).toMatchObject({
      id: transfer.id,
      partyId: party.id,
      type: LedgerEntryType.YOU_GAVE,
      isTransfer: true,
      transferPartyId: destination.id,
      linkedEntryId: 'offline-transfer-counterpart:transfer-1',
    });
    expect(destinationRow).toMatchObject({
      id: 'offline-transfer-counterpart:transfer-1',
      partyId: destination.id,
      type: LedgerEntryType.YOU_GOT,
      isTransfer: true,
      transferPartyId: party.id,
      linkedEntryId: transfer.id,
    });
    expect(projectPartyBalance(party, [transfer])).toMatchObject({
      currentBalance: 750,
      balanceType: 'YOU_WILL_GET',
    });
    expect(projectPartyBalance(destination, [transfer])).toMatchObject({
      currentBalance: 750,
      balanceType: 'YOU_WILL_GET',
    });
  });

  it('removes both transfer projections when replay permanently rejects it', () => {
    const rejectedTransfer = {
      ...queued('transfer-2', LedgerEntryType.YOU_GAVE, 250, 'party-2'),
      status: 'rejected' as const,
    };

    expect(queuedEntriesForParty([rejectedTransfer], party.id)).toEqual([]);
    expect(queuedEntriesForParty([rejectedTransfer], 'party-2')).toEqual([]);
    expect(mergeLedgerEntries([], [rejectedTransfer], party.id)).toEqual([]);
    expect(projectPartyBalance(party, queuedEntriesForParty([rejectedTransfer], party.id))).toMatchObject({
      currentBalance: party.currentBalance,
      balanceType: party.balanceType,
    });
  });

  it('uses replayed server IDs to avoid duplicate local and server rows', () => {
    const destination: Party = { ...party, id: 'party-2', name: 'Karim' };
    const transfer: QueuedEntry = {
      ...queued('transfer-3', LedgerEntryType.YOU_GAVE, 250, destination.id),
      serverEntryId: 'server-source',
      linkedServerEntryId: 'server-counterpart',
    };
    const sourceServerRow: LedgerEntry = {
      ...mergeLedgerEntries([], [transfer], party.id)[0],
      id: 'server-source',
      linkedEntryId: 'server-counterpart',
    };
    const destinationServerRow: LedgerEntry = {
      ...mergeLedgerEntries([], [transfer], destination.id)[0],
      id: 'server-counterpart',
      linkedEntryId: 'server-source',
    };

    expect(mergeLedgerEntries([sourceServerRow], [transfer], party.id)).toEqual([sourceServerRow]);
    expect(mergeLedgerEntries([destinationServerRow], [transfer], destination.id)).toEqual([destinationServerRow]);
  });
});
