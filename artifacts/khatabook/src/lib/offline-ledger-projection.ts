import type { LedgerEntry, Party } from '@workspace/api-client-react';
import type { QueuedEntry } from './entryOutbox';

/** Present queued entries through the same ledger row model as server entries. */
export function projectQueuedEntries(entries: QueuedEntry[]): LedgerEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    partyId: entry.partyId,
    type: entry.data.type,
    amount: entry.data.amount,
    description: entry.data.description ?? '',
    billReference: entry.data.billReference ?? null,
    billImage: entry.data.billImage ?? null,
    dueDate: entry.data.dueDate ?? null,
    createdAt: entry.createdAt,
    isTransfer: entry.data.isTransfer ?? false,
    transferPartyId: entry.data.transferPartyId ?? null,
    linkedEntryId: null,
  }));
}

export function mergeLedgerEntries(serverEntries: LedgerEntry[], queuedEntries: QueuedEntry[]): LedgerEntry[] {
  const localEntries = projectQueuedEntries(queuedEntries);
  const serverIds = new Set(serverEntries.map((entry) => entry.id));
  return [...serverEntries, ...localEntries.filter((entry) => !serverIds.has(entry.id))];
}

/** Local display balance includes queued deltas without mutating server query data. */
export function projectPartyBalance(party: Party, queuedEntries: QueuedEntry[]): Party {
  const serverBalance = party.balanceType === 'YOU_WILL_GET'
    ? party.currentBalance
    : -party.currentBalance;
  const balanceDelta = queuedEntries.reduce(
    (sum, entry) => sum + (entry.data.type === 'YOU_GAVE' ? entry.data.amount : -entry.data.amount),
    0,
  );
  const projectedBalance = serverBalance + balanceDelta;

  return {
    ...party,
    currentBalance: Math.abs(projectedBalance),
    balanceType: projectedBalance >= 0 ? 'YOU_WILL_GET' : 'YOU_WILL_GIVE',
  };
}
