/**
 * In-memory queue for bill images that failed to upload at save time.
 *
 * CLOUD-FIRST ARCHITECTURE — zero local storage:
 * No data is written to localStorage, IndexedDB, or any persistent browser
 * store. The queue lives in module memory for the lifetime of the current
 * page session — enough to survive React re-renders and route changes, but
 * intentionally discarded on page reload.
 *
 * This guarantees:
 *   - Zero local data accumulation on the device over months of use
 *   - No sensitive image data ever touches the device's permanent storage
 *   - The app stays lightweight regardless of transaction volume
 *
 * Trade-off: if the user closes the tab before connectivity is restored, the
 * pending image is lost from the retry queue. The ledger entry itself (amount,
 * date, description) was already committed durably to the cloud database —
 * only the bill photo attachment is missing. The user can re-attach it later.
 *
 * Retry flow: useRetryPendingUploads listens for the `online` event and
 * re-uploads each queued image, PATCHing the entry's billImage on the server.
 * Records are removed from the queue on success.
 */

export interface PendingUpload {
  entryId: string;
  partyId: string;
  base64: string;
  enqueuedAt: number; // Date.now() at enqueue time — used only for debugging
}

/** Module-level in-memory queue — persists across React re-renders, never to disk. */
const queue = new Map<string, PendingUpload>();

// ─── One-time migration ──────────────────────────────────────────────────────
// Erase any `pending_bill_uploads` data left by the previous localStorage-based
// implementation on existing devices. Runs once at module import (app start).
try {
  localStorage.removeItem('pending_bill_uploads');
} catch {
  // localStorage may be unavailable in some contexts — safe to ignore.
}
// ────────────────────────────────────────────────────────────────────────────

/**
 * Enqueue a failed bill image upload for background retry.
 * Deduplicates by entryId — a second save attempt for the same entry replaces
 * the previous record (idempotent).
 */
export function savePendingUpload(upload: Omit<PendingUpload, 'enqueuedAt'>): void {
  queue.set(upload.entryId, { ...upload, enqueuedAt: Date.now() });
}

/** Return all currently queued pending uploads (in insertion order). */
export function getPendingUploads(): PendingUpload[] {
  return Array.from(queue.values());
}

/** Remove a single record after a successful retry. */
export function removePendingUpload(entryId: string): void {
  queue.delete(entryId);
}

/**
 * Clear the entire queue.
 * Called on sign-out to ensure another user's in-flight retries don't bleed
 * into the next session. (With in-memory storage this is automatic on page
 * reload, but explicit clearing is still good hygiene for SPA tab reuse.)
 */
export function clearAllPendingUploads(): void {
  queue.clear();
}
