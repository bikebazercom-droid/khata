---
name: Browser legacy outbox transition
description: Project policy for online-only browser entry creation while preserving previously saved drafts.
---

New browser entries must be sent directly to the server. Do not add new browser offline queuing. Keep the old browser outbox drain during the transition so entries recorded by earlier builds can still be confirmed or remain recoverable; do not erase the outbox.

**Why:** Switching browser behavior should not strand drafts already saved by earlier builds.

**How to apply:** When changing transaction-entry or sync code, distinguish legacy web replay from new web create behavior.