import { describe, expect, it } from 'vitest';
import { formatLocalTime } from './date-time';

describe('formatLocalTime', () => {
  const transactionTime = '2026-10-02T14:52:00.000Z';

  it('formats the ledger time using the current local timezone in 24-hour style', () => {
    const localDate = new Date(transactionTime);
    const expected = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;
    expect(formatLocalTime(transactionTime)).toBe(expected);
  });

  it('retains the detail view 12-hour style in the current local timezone', () => {
    const localDate = new Date(transactionTime);
    const hour = localDate.getHours() % 12 || 12;
    const expected = `${String(hour).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')} ${localDate.getHours() >= 12 ? 'PM' : 'AM'}`;
    expect(formatLocalTime(transactionTime, true)).toBe(expected);
  });

  it('follows the local clock across a UTC date boundary', () => {
    const value = '2026-10-02T00:15:00.000Z';
    const localDate = new Date(value);
    const expected = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;
    expect(formatLocalTime(value)).toBe(expected);
  });
});