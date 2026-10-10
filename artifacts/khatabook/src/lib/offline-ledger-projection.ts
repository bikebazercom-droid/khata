import type { LedgerEntry, Party } from '@workspace/api-client-react';
import type { QueuedEntry } from './entryOutbox';

/** Queue records are stored once, then projected as either side of a transfer. */
export function queuedEntriesForParty(entries: QueuedEntry[], partyId: string): QueuedEntry[] {
  return entries.filter((entry) => {
    if (entry.data.isTransfer && entry.status === 'rejected') return false;
    return entry.partyId === partyId || (entry.data.isTransfer && entry.data.transferPartyId === partyId);
  });
}

/** Present queued entries through the same ledger row model as server entries. */
export function projectQueuedEntries(entries: QueuedEntry[], partyId: string): LedgerEntry[] {
  return entries.flatMap((entry) => {
    const isCounterparty = entry.partyId !== partyId &&
      entry.data.isTransfer &&
      entry.data.transferPartyId === partyId;
    if (entry.partyId !== partyId && !isCounterparty) return [];
    const id = isCounterparty
      ? `offline-transfer-counterpart:${entry.id}`
      : entry.id;
    const counterpartEntryId = `offline-transfer-counterpart:${entry.id}`;
    return [{
      id,
      partyId,
      type: (isCounterparty
        ? entry.data.type === 'YOU_GAVE' ? 'YOU_GOT' : 'YOU_GAVE'
        : entry.data.type) as LedgerEntry['type'],
      amount: entry.data.amount,
      description: entry.data.description ?? '',
      billReference: isCounterparty ? null : entry.data.billReference ?? null,
      billImage: isCounterparty ? null : entry.data.billImage ?? null,
      dueDate: entry.data.dueDate ?? null,
      createdAt: entry.createdAt,
      isTransfer: entry.data.isTransfer ?? false,
      transferPartyId: isCounterparty ? entry.partyId : entry.data.transferPartyId ?? null,
      linkedEntryId: isCounterparty ? entry.id : entry.data.isTransfer ? counterpartEntryId : null,
    }];
  });
}

export function mergeLedgerEntries(serverEntries: LedgerEntry[], queuedEntries: QueuedEntry[], partyId: string): LedgerEntry[] {
  const scopedQueue = queuedEntriesForParty(queuedEntries, partyId);
  const localEntries = projectQueuedEntries(scopedQueue, partyId);
  const serverIds = new Set(serverEntries.map((entry) => entry.id));
  const localRowsAlreadyOnServer = new Set(scopedQueue.flatMap((queued) => {
    const isCounterparty = queued.partyId !== partyId;
    const serverId = isCounterparty ? queued.linkedServerEntryId : queued.serverEntryId;
    if (!serverId || !serverIds.has(serverId)) return [];
    return [isCounterparty ? `offline-transfer-counterpart:${queued.id}` : queued.id];
  }));
  return [
    ...serverEntries,
    ...localEntries.filter((entry) => !serverIds.has(entry.id) && !localRowsAlreadyOnServer.has(entry.id)),
  ];
}

/** Local display balance includes queued deltas without mutating server query data. */
export function projectPartyBalance(party: Party, queuedEntries: QueuedEntry[]): Party {
  const serverBalance = party.balanceType === 'YOU_WILL_GET'
    ? party.currentBalance
    : -party.currentBalance;
  const balanceDelta = queuedEntriesForParty(queuedEntries, party.id).reduce(
    (sum, entry) => {
      const isCounterparty = entry.partyId !== party.id &&
        entry.data.isTransfer &&
        entry.data.transferPartyId === party.id;
      const type = isCounterparty
        ? entry.data.type === 'YOU_GAVE' ? 'YOU_GOT' : 'YOU_GAVE'
        : entry.data.type;
      return sum + (type === 'YOU_GAVE' ? entry.data.amount : -entry.data.amount);
    },
    0,
  );
  const projectedBalance = serverBalance + balanceDelta;

  return {
    ...party,
    currentBalance: Math.abs(projectedBalance),
    balanceType: projectedBalance >= 0 ? 'YOU_WILL_GET' : 'YOU_WILL_GIVE',
  };
}
