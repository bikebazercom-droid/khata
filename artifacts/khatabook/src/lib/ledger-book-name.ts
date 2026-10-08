/**
 * Pick the current per-book name before older business/profile labels.
 * A blank edited name should not hide a valid fallback.
 */
export function resolveLedgerBookName(
  ...candidates: Array<string | null | undefined>
): string | undefined {
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim();
}
