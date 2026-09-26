---
name: Offline ledger replay invariants
description: Why pending drafts, permissions and replay receipts must stay separate from confirmed accounting.
---

Retain idempotency receipts even after deleting a posted entry; a replay key must never become eligible to create a new entry again.

**Why:** An offline device can retry an old request after another device deletes the resulting transaction. Deleting its receipt would recreate that transaction and change balances unexpectedly.

**How to apply:** Any retention or cleanup policy must preserve replay protection. Check the current actor, business and permissions before returning an old result. Do not transfer pending drafts across accounts.

Pending drafts do not contribute to confirmed balances.

**Why:** An offline write can be rejected after permission revocation. Showing it as confirmed would misrepresent the ledger before the server has accepted it.

**How to apply:** Keep pending/rejected drafts visible separately and leave them recoverable on failed synchronization.