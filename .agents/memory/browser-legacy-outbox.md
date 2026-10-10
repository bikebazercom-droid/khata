---
name: Browser legacy outbox transition
description: Offline-first policy for shared browser and mobile WebView ledger data.
---

The shared website data layer is the source of truth for browser and mobile WebView use. New ledger entries may be saved locally as pending before background replay for instant feedback; other writes enter an outbox only when offline or when a request fails without an HTTP response. An HTTP error is a server result, not proof of lost connectivity. Keep pending data scoped to its actor and business, replay writes idempotently, and never count pending ledger entries as confirmed balances.

**Why:** A large ledger amount can be rejected by the database and return HTTP 500. Treating every 5xx as offline hid the server rejection and stranded the entry as a pending draft. Local-first entry creation is an intentional exception so the form can close immediately while the entry remains visibly unconfirmed.

**How to apply:** Keep local-first creates visibly pending and exclude them from confirmed balances until replay succeeds. In shared web and Expo WebView code, inspect an HTTP status before classifying other writes as offline; surface HTTP 4xx/5xx errors rather than treating them as lost connectivity. Keep outbox identity, idempotent replay, confirmed-balance rules, and delete dependencies intact.