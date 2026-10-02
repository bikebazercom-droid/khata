type ChronologicalEntry = {
  id: string;
  createdAt: string;
};

export function sortGlobalLedgerEntriesNewestFirst<T extends ChronologicalEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) => {
    const timestampOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return timestampOrder || right.id.localeCompare(left.id);
  });
}