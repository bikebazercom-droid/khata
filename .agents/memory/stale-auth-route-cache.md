---
name: Fresh auth checks on sign-in routes
description: Prevent cached auth-me results from redirecting signed-out users away from public sign-in pages.
---

Public sign-in routes must decide whether to redirect using a fresh server-side `/api/auth/me` check for that visit, not a successful result cached by the regular app auth observer. Keep offline-identity fallback disabled on those routes.

**Why:** A prior successful auth query can remain available while React Query starts a background refetch. If the user is now signed out, the stale success can make the sign-in route redirect to the home page before the server's 401 arrives.

**How to apply:** Give each sign-in route mount an isolated auth-me query key that preserves the `auth-me` prefix and user-id position used by the 401 cleanup predicate. Do not persist these route-check queries. Keep regular protected-route observers on their shared key so offline ledger behavior remains unchanged.
