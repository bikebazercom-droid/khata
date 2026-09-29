---
name: PostgreSQL pooler compatibility
description: External Postgres pooling mode required by the live-update event bus.
---

For Supabase, use Session mode pooling or a direct connection. Do not use transaction mode: the app's event bus keeps a persistent PostgreSQL client subscribed with `LISTEN` and relies on `NOTIFY`.

**Why:** Transaction pooling can assign a different server connection between statements, so session-level listeners do not remain attached reliably.

**How to apply:** When configuring an external PostgreSQL database, select Supabase's Session pooler for an IPv4-friendly persistent backend, or use a direct connection if the host supports its network requirements. Keep the database URL server-side.