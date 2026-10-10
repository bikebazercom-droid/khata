---
name: Offline ledger replay invariants
description: Why pending drafts, permissions and replay receipts must stay separate from confirmed accounting.
---

Retain idempotency receipts even after deleting a posted entry; a replay key must never become eligible to create a new entry again.

**Why:** An offline device can retry an old request after another device deletes the resulting transaction. Deleting its receipt would recreate that transaction and change balances unexpectedly.

**How to apply:** Any retention or cleanup policy must preserve replay protection. On permanent entry deletion, redact the receipt's transaction payload but retain its business, actor, request ID and fingerprint, then reject matching retries. Check the current actor, business and permissions before returning an old result. Do not transfer pending drafts across accounts.

Queued entries remain distinct in storage from server-confirmed records, but the party ledger projects them into the ordinary entry list and local running balance without a pending marker.

**Why:** The user explicitly wants offline-created entries to look and behave like normal entries, update the displayed balance immediately, and sync silently; the server's stored balance still remains authoritative.

**How to apply:** Derive each party's local display balance from actor/business-scoped queued deltas. A transfer projects a second row to its destination with the opposite entry type and links both local IDs; hide both projections if replay rejects it. Do not mutate confirmed query data. Preserve idempotency and use server-returned pair IDs to avoid duplicate rows during replay.

All entry creation is queued locally before background API replay, with the ordinary ledger rendering the local projection immediately.

**Why:** The user explicitly requested the same visible ledger experience online and offline, with immediate local balance changes and silent background sync.

**How to apply:** Persist the idempotent request before closing the form; merge the scoped outbox into ledger rows and project its deltas for display. Replay the same request ID and let server responses refresh confirmed cache data.

When evicting persisted query data, clear matching entries from both the saved snapshot and the debounced dirty-write buffer; compare generated query-key prefixes so appended business scopes are included.

**Why:** A pending persistence timer can restore stale ledger data after an entry is deleted or its cache is invalidated.

**How to apply:** Any targeted cache eviction must prevent already-queued writes from flushing the evicted data back to storage.