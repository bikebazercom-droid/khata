import { describe, expect, it } from 'vitest';
import { PartyRole, type GlobalLedgerEntry } from '@workspace/api-client-react';
import { filterGlobalLedgerEntriesByRole } from '@/lib/global-ledger-report-role';

function entry(id: string, partyRole: PartyRole): GlobalLedgerEntry {
  return {
    id,
    partyId: `party-${id}`,
    partyName: id,
    partyPhone: '',
    partyRole,
    type: 'YOU_GOT',
    amount: 10,
    description: '',
    billReference: null,
    billImage: null,
    dueDate: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('filterGlobalLedgerEntriesByRole', () => {
  it('keeps supplier reports strictly limited to supplier ledger entries', () => {
    const customer = entry('customer', PartyRole.CUSTOMER);
    const supplier = entry('supplier', PartyRole.SUPPLIER);

    expect(filterGlobalLedgerEntriesByRole([customer, supplier], PartyRole.SUPPLIER))
      .toEqual([supplier]);
  });
});