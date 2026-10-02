import { describe, expect, it } from 'vitest';
import { formatTimeInUtc } from './date-time';

describe('formatTimeInUtc', () => {
  const transactionTime = '2026-10-02T14:52:00.000Z';

  it('formats the ledger time in 24-hour UTC', () => {
    expect(formatTimeInUtc(transactionTime)).toBe('14:52');
  });

  it('can retain the detail view 12-hour style while using UTC', () => {
    expect(formatTimeInUtc(transactionTime, true)).toBe('02:52 PM');
  });

  it('keeps midnight in the UTC day', () => {
    expect(formatTimeInUtc('2026-10-02T00:15:00.000Z')).toBe('00:15');
  });
});