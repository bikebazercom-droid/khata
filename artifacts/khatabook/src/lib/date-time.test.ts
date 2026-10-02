import { describe, expect, it } from 'vitest';
import { formatLocalTime } from './date-time';

describe('formatLocalTime', () => {
  const transactionTime = '2026-10-02T14:52:00.000Z';

  const expectedLocalTime = (value: string) => {
    const localDate = new Date(value);
    const hour = localDate.getHours() % 12 || 12;
    return `${String(hour).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')} ${localDate.getHours() >= 12 ? 'PM' : 'AM'}`;
  };

  it('uses the current local timezone and includes an AM/PM indicator', () => {
    expect(formatLocalTime(transactionTime)).toBe(expectedLocalTime(transactionTime));
    expect(formatLocalTime(transactionTime)).toMatch(/ (AM|PM)$/);
  });

  it('keeps the same 12-hour style for transaction details', () => {
    expect(formatLocalTime(transactionTime)).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
  });

  it('follows the local clock across a UTC date boundary', () => {
    const value = '2026-10-02T00:15:00.000Z';
    expect(formatLocalTime(value)).toBe(expectedLocalTime(value));
  });
});