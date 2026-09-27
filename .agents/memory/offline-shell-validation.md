---
name: Offline shell validation
description: Production-only service-worker checks require compiled assets and a browser-reachable secure origin.
---

Validate offline shell behavior against the compiled application on a browser-reachable HTTPS origin, not the normal development server.

**Why:** The worker deliberately installs only in production. Development-mode checks do not exercise installation, cached navigation, or asset version consistency.

**How to apply:** Use compiled assets on a browser-reachable secure origin. Keep cache/identity fixtures isolated and use generated API types; label fixture-based replay separately from genuine server writes.