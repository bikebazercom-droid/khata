import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBusinessReportRange } from './business-report.ts';

function localDate(year, month, day) {
  return new Date(year, month - 1, day, 12);
}

test('ALL leaves both date bounds unset', () => {
  assert.deepEqual(
    resolveBusinessReportRange(
      'ALL',
      localDate(2026, 5, 8),
      localDate(2026, 5, 20),
      localDate(2026, 5, 14),
    ),
    {},
  );
});

test('THIS_MONTH returns inclusive first and last days, including leap February', () => {
  assert.deepEqual(
    resolveBusinessReportRange('THIS_MONTH', null, null, localDate(2024, 2, 10)),
    { startDate: '2024-02-01', endDate: '2024-02-29' },
  );
});

test('SINGLE_DAY uses the selected date for both inclusive bounds and defaults to today', () => {
  assert.deepEqual(
    resolveBusinessReportRange('SINGLE_DAY', localDate(2026, 9, 4), null, localDate(2026, 9, 29)),
    { startDate: '2026-09-04', endDate: '2026-09-04' },
  );
  assert.deepEqual(
    resolveBusinessReportRange('SINGLE_DAY', null, null, localDate(2026, 9, 29)),
    { startDate: '2026-09-29', endDate: '2026-09-29' },
  );
});

test('LAST_WEEK includes today and the six previous days across month/year boundaries', () => {
  assert.deepEqual(
    resolveBusinessReportRange('LAST_WEEK', null, null, localDate(2026, 3, 3)),
    { startDate: '2026-02-25', endDate: '2026-03-03' },
  );
  assert.deepEqual(
    resolveBusinessReportRange('LAST_WEEK', null, null, localDate(2026, 1, 5)),
    { startDate: '2025-12-30', endDate: '2026-01-05' },
  );
});

test('LAST_MONTH returns the full previous month across a year boundary', () => {
  assert.deepEqual(
    resolveBusinessReportRange('LAST_MONTH', null, null, localDate(2026, 1, 15)),
    { startDate: '2025-12-01', endDate: '2025-12-31' },
  );
});

test('CUSTOM_RANGE preserves inclusive endpoints across a year boundary and permits one-sided ranges', () => {
  assert.deepEqual(
    resolveBusinessReportRange('CUSTOM_RANGE', localDate(2025, 12, 31), localDate(2026, 1, 2)),
    { startDate: '2025-12-31', endDate: '2026-01-02' },
  );
  assert.deepEqual(
    resolveBusinessReportRange('CUSTOM_RANGE', localDate(2026, 1, 2), null),
    { startDate: '2026-01-02', endDate: undefined },
  );
  assert.deepEqual(
    resolveBusinessReportRange('CUSTOM_RANGE', null, localDate(2026, 1, 2)),
    { startDate: undefined, endDate: '2026-01-02' },
  );
});