import { describe, expect, it, vi } from 'vitest';
import type { LedgerRecord, PartyRecord } from '@/lib/domain';

vi.mock('expo-print', () => ({ printAsync: vi.fn(), printToFileAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));

import {
  buildPartyStatementHtml,
  calculatePartyStatement,
  embedPartyStatementBillImages,
} from '@/lib/reportPdf';

const ledgerEntry: LedgerRecord = {
  id: 'transaction-1',
  partyId: 'party-1',
  type: 'YOU_GAVE',
  amount: 100,
  description: '<invoice>',
  billImage: '/objects/test-image',
  billReference: null,
  dueDate: null,
  createdAt: '2025-06-15T10:00:00.000Z',
};

const party: PartyRecord = {
  id: 'party-1',
  name: 'Alice',
  phone: '',
  role: 'CUSTOMER',
  currentBalance: 100,
  balanceType: 'YOU_WILL_GET',
  dueDate: null,
  lastTransactionAt: ledgerEntry.createdAt,
  createdAt: ledgerEntry.createdAt,
};

describe('party statement PDF helpers', () => {
  it('includes available bill thumbnails in the HTML and escapes descriptions', () => {
    const statement = calculatePartyStatement([ledgerEntry], 'all');
    const html = buildPartyStatementHtml({
      businessName: 'Shop',
      party,
      periodLabel: 'সব সময়',
      statement,
      billImages: new Map([[ledgerEntry.id, 'data:image/png;base64,AQID']]),
    });
    expect(html).toContain('src="data:image/png;base64,AQID"');
    expect(html).toContain('&lt;invoice&gt;');
  });

  it('filters statement rows by date and search while retaining the real opening and running balance', () => {
    const records: LedgerRecord[] = [
      { ...ledgerEntry, id: 'before', amount: 30, createdAt: '2025-06-01T10:00:00.000Z' },
      { ...ledgerEntry, id: 'match', type: 'YOU_GOT', amount: 8, description: 'matched note', createdAt: '2025-06-12T10:00:00.000Z' },
      { ...ledgerEntry, id: 'hidden', amount: 2, description: 'other note', createdAt: '2025-06-13T10:00:00.000Z' },
    ];
    const statement = calculatePartyStatement(records, 'custom', new Date(2025, 5, 20), {
      startDate: new Date(2025, 5, 10),
      endDate: new Date(2025, 5, 15),
      search: 'MATCHED',
    });
    expect(statement.openingBalance).toBe(30);
    expect(statement.entries.map((item) => item.id)).toEqual(['match']);
    expect(statement.gave).toBe(2);
    expect(statement.received).toBe(8);
    expect(statement.closingBalance).toBe(24);
    expect(statement.runningBalances.get('match')).toBe(22);
  });

  it('embeds authenticated images within size limits and reports failures without throwing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const entries = [
        ledgerEntry,
        { ...ledgerEntry, id: 'unavailable', billImage: '/objects/forbidden' },
      ];
      const result = await embedPartyStatementBillImages(entries, 'access-token');
      expect(result.images.get('transaction-1')).toBe('data:image/png;base64,AQID');
      expect(result.failedCount).toBe(1);
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer access-token' },
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});