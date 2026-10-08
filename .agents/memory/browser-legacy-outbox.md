---
name: Browser legacy outbox transition
description: Offline-first policy for shared browser and mobile WebView ledger data.
---

The shared website data layer is the source of truth for browser and mobile WebView use. Queue ledger and customer writes only when the device is offline or the request fails without an HTTP response; an HTTP error is a server result, not proof of lost connectivity. Keep pending data scoped to its actor and business, replay writes idempotently, and never count pending ledger entries as confirmed balances.

**Why:** A large ledger amount can be rejected by the database and return HTTP 500. Treating every 5xx as offline hid the server rejection and stranded the entry as a pending draft.

**How to apply:** In shared web and Expo WebView code, inspect an HTTP status before checking `navigator.onLine`; surface HTTP 4xx/5xx errors and queue only explicit offline or transport failures. Keep outbox identity, idempotent replay, confirmed-balance rules, and delete dependencies intact.