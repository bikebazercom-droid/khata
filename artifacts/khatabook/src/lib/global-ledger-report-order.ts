import { getLedgerEntryDateKey } from './date-time';

type ChronologicalEntry = {
  id: string;
  createdAt: string | Date;
  dueDate?: string | null;
};

type NewestFirstEntry = {
  id: string;
  createdAt: string;
};

export function sortGlobalLedgerEntriesChronologically<T extends ChronologicalEntry>(
  entries: readonly T[],
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftDay = getLedgerEntryDateKey(left.entry.dueDate, left.entry.createdAt);
      const rightDay = getLedgerEntryDateKey(right.entry.dueDate, right.entry.createdAt);
      const dayOrder = leftDay.localeCompare(rightDay);
      if (dayOrder) return dayOrder;

      const timeOrder =
        new Date(left.entry.createdAt).getTime() -
        new Date(right.entry.createdAt).getTime();
      return timeOrder || left.entry.id.localeCompare(right.entry.id) || left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function sortGlobalLedgerEntriesNewestFirst<T extends NewestFirstEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) => {
    const timestampOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return timestampOrder || right.id.localeCompare(left.id);
  });
}