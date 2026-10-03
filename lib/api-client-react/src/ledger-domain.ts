function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

export function getLocalDateKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('Invalid ledger entry date');
  }

  const year = String(date.getFullYear()).padStart(4, '0');
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  return `${year}-${month}-${day}`;
}

/**
 * Returns the ledger's business date without timezone-shifting date-only
 * values. A supplied due date must be a real calendar date.
 */
export function getLedgerEntryDateKey(
  dueDate: string | null | undefined,
  createdAt: string | Date,
): string {
  if (dueDate) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(dueDate);
    if (!match) {
      throw new RangeError(`Invalid ledger entry date: ${dueDate}`);
    }

    const [, year, month, day] = match;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (
      localDate.getFullYear() !== Number(year) ||
      localDate.getMonth() !== Number(month) - 1 ||
      localDate.getDate() !== Number(day)
    ) {
      throw new RangeError(`Invalid ledger entry date: ${dueDate}`);
    }

    return `${year}-${month}-${day}`;
  }

  const creationDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return getLocalDateKey(creationDate);
}

/** Formats transaction creation time in the viewer's local timezone. */
export function formatLocalTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}