---
name: Browser legacy outbox transition
description: Offline-first policy for shared browser and mobile WebView ledger data.
---

The shared website data layer is the source of truth for browser and mobile WebView use. New ledger entries are saved locally before background replay and projected into the ordinary ledger rows and displayed balance without a pending marker; the server's confirmed query data remains untouched. Other writes enter an outbox only when offline or when a request fails without an HTTP response. Keep queue data scoped to its actor and business and replay writes idempotently.

**Why:** The user explicitly requested the same visible ledger experience online and offline, including immediate local balance changes and silent background sync.

**How to apply:** Keep request identity, actor/business scoping, replay protection, and delete dependencies intact. Show local queued deltas in the party ledger projection, not as server-confirmed API data. Keep non-entry writes' existing distinction between network failures and HTTP server responses.