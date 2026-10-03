import { describe, expect, it } from 'vitest';
import { formatPickerDate, getCalendarDays, parseLocalIsoDate, toLocalIsoDate } from '@/lib/datePicker';

describe('date picker helpers', () => {
  it('round-trips date-only values without applying a timezone shift', () => {
    const date = parseLocalIsoDate('2026-10-03');
    expect(date).not.toBeNull();
    expect(toLocalIsoDate(date!)).toBe('2026-10-03');
  });

  it('rejects impossible calendar dates', () => {
    expect(parseLocalIsoDate('2026-02-30')).toBeNull();
  });

  it('builds a six-week grid including leap days', () => {
    const days = getCalendarDays(2024, 1);
    expect(days).toHaveLength(42);
    expect(days.filter(Boolean)).toHaveLength(29);
    expect(formatPickerDate('2026-10-03')).toBe('3 October 2026');
  });
});