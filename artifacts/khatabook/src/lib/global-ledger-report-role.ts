import type { GlobalLedgerEntry, PartyRole } from '@workspace/api-client-react';

export function filterGlobalLedgerEntriesByRole(
  entries: readonly GlobalLedgerEntry[],
  partyRole: PartyRole,
): GlobalLedgerEntry[] {
  return entries.filter((entry) => entry.partyRole === partyRole);
}