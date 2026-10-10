---
name: Offline ledger replay invariants
description: Why pending drafts, permissions and replay receipts must stay separate from confirmed accounting.
---

Retain idempotency receipts even after deleting a posted entry; a replay key must never become eligible to create a new entry again.

**Why:** An offline device can retry an old request after another device deletes the resulting transaction. Deleting its receipt would recreate that transaction and change balances unexpectedly.

**How to apply:** Any retention or cleanup policy must preserve replay protection. On permanent entry deletion, redact the receipt's transaction payload but retain its business, actor, request ID and fingerprint, then reject matching retries. Check the current actor, business and permissions before returning an old result. Do not transfer pending drafts across accounts.

Pending drafts do not contribute to confirmed balances.

**Why:** An offline write can be rejected after permission revocation. Showing it as confirmed would misrepresent the ledger before the server has accepted it.

**How to apply:** Keep pending/rejected drafts visible separately and leave them recoverable on failed synchronization.

Online entry creation is also queued locally before the background API replay.

**Why:** Waiting for a network round trip made the save interaction feel blocked; showing a pending draft is immediate without claiming the server has confirmed its balance effect.

**How to apply:** Persist the idempotent request before closing the entry form, keep the draft visibly pending, and update confirmed ledger/balance queries only after replay succeeds.

When evicting persisted query data, clear matching entries from both the saved snapshot and the debounced dirty-write buffer; compare generated query-key prefixes so appended business scopes are included.

**Why:** A pending persistence timer can restore stale ledger data after an entry is deleted or its cache is invalidated.

**How to apply:** Any targeted cache eviction must prevent already-queued writes from flushing the evicted data back to storage.