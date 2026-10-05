---
name: Readiness probe pool
description: Timeout ordering and connection isolation for database readiness checks.
---

Keep PostgreSQL readiness probes on a dedicated one-client pool; do not change the shared ledger pool's query timeouts. The client-side query timeout should fire before the server-side `statement_timeout` fallback, and connection acquisition should also have its own bound. Concurrent HTTP probes should share one in-flight check.

**Why:** The client query timeout produces an error that makes node-postgres remove the affected pooled client. The later server timeout is a safety net if the client timeout path does not complete. A dedicated pool and single-flight probe prevent readiness checks from consuming normal ledger capacity or piling up during a stall.

**How to apply:** When changing readiness timing, preserve the timeout ordering and dedicated pool. Validate with a read-only stalled query, observe the pool's client-removal event, and then confirm a later readiness request acquires a connection successfully.
