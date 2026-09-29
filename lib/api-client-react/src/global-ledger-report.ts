import type { GlobalLedgerEntry } from './generated/api.schemas';

export type GlobalLedgerReportPeriod =
  | 'ALL'
  | 'THIS_MONTH'
  | 'SINGLE_DAY'
  | 'LAST_WEEK'
  | 'LAST_MONTH'
  | 'CUSTOM_RANGE';

export interface GlobalLedgerReportRange {
  startDate?: string;
  endDate?: string;
}

export interface GlobalLedgerReportQuery extends GlobalLedgerReportRange {
  search?: string;
}

export interface GlobalLedgerReportTotals {
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
  entryCount: number;
}

function dateOnly(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveGlobalLedgerReportRange(
  period: GlobalLedgerReportPeriod,
  customStart: Date | null,
  customEnd: Date | null,
  now = new Date(),
): GlobalLedgerReportRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'ALL':
      return {};
    case 'THIS_MONTH':
      return {
        startDate: dateOnly(new Date(today.getFullYear(), today.getMonth(), 1)),
        endDate: dateOnly(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    case 'SINGLE_DAY': {
      const day = customStart ?? today;
      return { startDate: dateOnly(day), endDate: dateOnly(day) };
    }
    case 'LAST_WEEK': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { startDate: dateOnly(start), endDate: dateOnly(today) };
    }
    case 'LAST_MONTH': {
      const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return {
        startDate: dateOnly(previousMonth),
        endDate: dateOnly(new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0)),
      };
    }
    case 'CUSTOM_RANGE':
      return {
        startDate: customStart ? dateOnly(customStart) : undefined,
        endDate: customEnd ? dateOnly(customEnd) : undefined,
      };
  }
}

export function normalizeGlobalLedgerReportSearch(search: string): string | undefined {
  const normalized = search.trim();
  return normalized || undefined;
}

export function buildGlobalLedgerReportQuery(
  period: GlobalLedgerReportPeriod,
  customStart: Date | null,
  customEnd: Date | null,
  search: string,
  now = new Date(),
): GlobalLedgerReportQuery {
  return {
    ...resolveGlobalLedgerReportRange(period, customStart, customEnd, now),
    search: normalizeGlobalLedgerReportSearch(search),
  };
}

export function calculateGlobalLedgerReportTotals(
  entries: readonly Pick<GlobalLedgerEntry, 'type' | 'amount'>[],
): GlobalLedgerReportTotals {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    if (entry.type === 'YOU_GAVE') totalDebit += entry.amount;
    else if (entry.type === 'YOU_GOT') totalCredit += entry.amount;
  }
  return {
    totalDebit,
    totalCredit,
    netBalance: totalCredit - totalDebit,
    entryCount: entries.length,
  };
}