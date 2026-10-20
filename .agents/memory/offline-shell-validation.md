---
name: Offline shell validation
description: Production-only service-worker checks require compiled assets and a browser-reachable secure origin.
---

Validate offline shell behavior against the compiled application on a browser-reachable HTTPS origin, not the normal development server.

**Why:** The worker deliberately installs only in production. Development-mode checks do not exercise installation, cached navigation, or asset version consistency.

Do not reload on every `controllerchange`: a new document can itself receive a controller, causing repeated reloads. If an upgraded shell must refresh open clients, notify them with the activated shell version and deduplicate by that version. Keep public sign-in and sign-up routes available when the API connectivity probe fails; only protected ledger routes should show the connection gate.

**Why:** A controller-change reload loop can block sign-in, and applying the offline gate to auth routes prevents users from reaching Clerk during transient API failures.

**How to apply:** Use compiled assets on a browser-reachable secure origin. Test consecutive worker upgrades and direct loads of `/sign-in` and `/sign-up`, including when `/api/healthz` rejects. Keep cache/identity fixtures isolated and label fixture-based replay separately from genuine server writes.