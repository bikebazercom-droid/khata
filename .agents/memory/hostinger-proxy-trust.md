---
name: Hostinger proxy trust
description: Reverse proxy trust settings and rate-limiter client-IP behavior.
---

For the combined production app on Hostinger, Express must trust the platform ingress hop so `req.ip` and `express-rate-limit` use the client address rather than the shared proxy address. Use the one-hop production default or explicitly verified `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_CIDRS`; never set unrestricted `trust proxy: true`.

**Why:** Leaving proxy trust disabled triggers express-rate-limit's forwarded-header validation and can collapse every visitor onto the same rate-limit key. Trusting arbitrary forwarded headers would instead let clients spoof their IP and evade limits.

**How to apply:** Keep the proxy hop count aligned with Hostinger's ingress topology, and test a request carrying `X-Forwarded-For` to ensure the limiter resolves the expected client IP. Revisit this setting if the hosting topology changes.
