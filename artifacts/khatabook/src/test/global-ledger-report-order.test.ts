import { describe, expect, it } from 'vitest';
import { sortGlobalLedgerEntriesNewestFirst } from '../lib/global-ledger-report-order';

describe('sortGlobalLedgerEntriesNewestFirst', () => {
  it('orders later dates and times first, with a stable tie-break for equal timestamps', () => {
    const entries = [
      { id: 'older', createdAt: '2026-10-01T23:59:59.000Z' },
      { id: 'same-a', createdAt: '2026-10-02T10:48:00.000Z' },
      { id: 'newer-day', createdAt: '2026-10-03T00:00:00.000Z' },
      { id: 'same-z', createdAt: '2026-10-02T10:48:00.000Z' },
      { id: 'same-earlier', createdAt: '2026-10-02T10:47:00.000Z' },
    ];

    expect(sortGlobalLedgerEntriesNewestFirst(entries).map(({ id }) => id)).toEqual([
      'newer-day',
      'same-z',
      'same-a',
      'same-earlier',
      'older',
    ]);
  });

  it('does not mutate the input list', () => {
    const entries = [
      { id: 'older', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'newer', createdAt: '2026-10-02T00:00:00.000Z' },
    ];

    sortGlobalLedgerEntriesNewestFirst(entries);

    expect(entries.map(({ id }) => id)).toEqual(['older', 'newer']);
  });
});