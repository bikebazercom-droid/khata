---
name: Browser and APK write boundary
description: Project policy for online-only browser entry creation while preserving Android's offline queue.
---

New browser entries must be sent directly to the server. Do not add new browser offline queuing. Keep the old browser outbox drain during the transition so entries recorded by earlier builds can still be confirmed or remain recoverable; do not erase the outbox. Android retains its own offline queue, automatic replay, and live-sync path.

**Why:** Switching browser behavior should not strand drafts already saved by earlier builds, while Android remains the supported offline client.

**How to apply:** When changing transaction-entry or sync code, distinguish legacy web replay from new web create behavior; change mobile sync only if explicitly requested.