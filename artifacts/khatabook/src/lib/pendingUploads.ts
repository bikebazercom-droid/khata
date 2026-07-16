/**
 * Persistent store for bill images that failed to upload at save time.
 *
 * When a transaction is saved while offline (or on a flaky connection), the
 * base64 image data and the real server-assigned entry ID are persisted here
 * so a background retry service can re-attempt the upload once connectivity
 * is restored.
 *
 * Storage: localStorage under the key `pending_bill_uploads`.
 * TTL: 7 days — entries older than this are discarded automatically on every
 *      read to prevent unbounded accumulation.
 *
 * Each record contains:
 *   entryId     — the server-assigned UUID for the ledger entry
 *   partyId     — needed to call PATCH /api/parties/:partyId/ledger-entries/:entryId
 *   base64      — the full base64 data URL of the bill image
 *   savedAt     — ISO timestamp used to enforce the TTL
 */

const STORAGE_KEY = 'pending_bill_uploads';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PendingUpload {
  entryId: string;
  partyId: string;
  base64: string;
  savedAt: string; // ISO timestamp
}

function readAll(): PendingUpload[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingUpload[];
  } catch {
    return [];
  }
}

function writeAll(records: PendingUpload[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage may be full or unavailable in private mode — silently ignore.
  }
}

/** Drop entries that are older than the TTL. */
function purgExpired(records: PendingUpload[]): PendingUpload[] {
  const cutoff = Date.now() - TTL_MS;
  return records.filter((r) => new Date(r.savedAt).getTime() > cutoff);
}

/**
 * Persist a failed bill image upload so it can be retried later.
 * Deduplicated by entryId — if a record for the same entry already exists it
 * is replaced (e.g. a second save attempt from the same session).
 */
export function savePendingUpload(upload: Omit<PendingUpload, 'savedAt'>): void {
  const existing = purgExpired(readAll()).filter((r) => r.entryId !== upload.entryId);
  writeAll([...existing, { ...upload, savedAt: new Date().toISOString() }]);
}

/** Return all non-expired pending uploads. */
export function getPendingUploads(): PendingUpload[] {
  const all = readAll();
  const live = purgExpired(all);
  // Persist the pruned list so expired entries are cleaned up eagerly.
  if (live.length !== all.length) writeAll(live);
  return live;
}

/** Remove a single pending upload record after a successful retry. */
export function removePendingUpload(entryId: string): void {
  writeAll(purgExpired(readAll()).filter((r) => r.entryId !== entryId));
}

/** Remove all pending upload records (e.g. on sign-out). */
export function clearAllPendingUploads(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
