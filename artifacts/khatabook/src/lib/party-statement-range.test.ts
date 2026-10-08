import { describe, expect, it } from 'vitest';
import {
  resolvePartyStatementDateRange,
  type PartyStatementEntry,
} from './party-statement';

const entries: PartyStatementEntry[] = [
  {
    id: 'later-created-earlier-date',
    type: 'YOU_GOT',
    amount: 25,
    dueDate: '2025-06-12',
    createdAt: '2025-07-01T10:00:00.000Z',
  },
  {
    id: 'oldest',
    type: 'YOU_GAVE',
    amount: 10,
    dueDate: '2025-06-01',
    createdAt: '2025-06-01T10:00:00.000Z',
  },
];

describe('resolvePartyStatementDateRange', () => {
  it('uses the actual earliest and latest business dates for an all-time statement', () => {
    expect(resolvePartyStatementDateRange(null, entries)).toEqual({
      start: new Date(2025, 5, 1),
      end: new Date(2025, 5, 12),
    });
  });

  it('keeps the selected filter range when one is provided', () => {
    const selectedRange = {
      start: new Date(2025, 5, 5),
      end: new Date(2025, 5, 20),
    };

    expect(resolvePartyStatementDateRange(selectedRange, entries)).toBe(selectedRange);
  });

  it('returns no date range for an empty all-time statement', () => {
    expect(resolvePartyStatementDateRange(null, [])).toBeNull();
  });
});
