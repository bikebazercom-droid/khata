import { describe, expect, it } from 'vitest';
import {
  sortGlobalLedgerEntriesChronologically,
  sortGlobalLedgerEntriesNewestFirst,
} from '../lib/global-ledger-report-order';

describe('sortGlobalLedgerEntriesChronologically', () => {
  it('orders statement rows by business date, then by creation time within the day', () => {
    const entries = [
      { id: 'latest-date', dueDate: '2026-10-03', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'same-day-later', dueDate: '2026-10-02', createdAt: '2026-10-02T10:48:00.000Z' },
      { id: 'oldest-date', dueDate: '2024-01-01', createdAt: '2026-10-04T00:00:00.000Z' },
      { id: 'same-day-earlier', dueDate: '2026-10-02', createdAt: '2026-10-02T10:47:00.000Z' },
      { id: 'fallback-date', dueDate: null, createdAt: '2025-01-01T00:00:00.000Z' },
    ];

    expect(sortGlobalLedgerEntriesChronologically(entries).map(({ id }) => id)).toEqual([
      'oldest-date',
      'fallback-date',
      'same-day-earlier',
      'same-day-later',
      'latest-date',
    ]);
  });

  it('does not mutate the input list', () => {
    const entries = [
      { id: 'newer', dueDate: '2026-10-02', createdAt: '2026-10-02T00:00:00.000Z' },
      { id: 'older', dueDate: '2026-10-01', createdAt: '2026-10-01T00:00:00.000Z' },
    ];

    sortGlobalLedgerEntriesChronologically(entries);

    expect(entries.map(({ id }) => id)).toEqual(['newer', 'older']);
  });
});

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