---
name: Browser legacy outbox transition
description: Offline-first policy for shared browser and mobile WebView ledger data.
---

The shared website data layer is the source of truth for browser and mobile WebView use. New ledger entries and customer create, update, and delete actions may be queued offline. Keep pending data scoped to its actor and business, replay writes idempotently, and never count pending ledger entries as confirmed balances.

**Why:** The user explicitly requested offline customer management, reports, and downloads in the shared layer so mobile WebView and web remain aligned while keeping Clerk and phone OTP.

**How to apply:** Keep offline reads, durable outboxes, and reconnect/resume replay in the shared website layer. Preserve recoverability for queued work and defer destructive deletes until dependent ledger drafts have synced.