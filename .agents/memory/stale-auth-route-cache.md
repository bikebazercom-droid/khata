---
name: Fresh auth checks on sign-in routes
description: Prevent cached auth-me results from redirecting signed-out users away from public sign-in pages.
---

Public sign-in routes must render without waiting for `/api/auth/me` or an existing Clerk session to settle. If a route needs to make a redirect decision, use a fresh server-side check for that visit, not a successful result cached by the regular app auth observer. Keep offline-identity fallback disabled on those routes. Do not automatically redirect from `/sign-in` to `/` after an auth result; keep the sign-in form available.

**Why:** A prior successful auth query can remain available while React Query starts a background refetch. If the user is now signed out, the stale success can make the sign-in route redirect to the home page before the server's 401 arrives. Separately, gating the sign-in UI on the `/api/auth/me` request leaves users staring at a spinner when that request or Clerk initialization stalls.

**How to apply:** Render the sign-in UI independently of current-session checks. If a public route separately needs a server auth query, give each visit an isolated key that preserves the `auth-me` prefix and user-id position used by the 401 cleanup predicate. Do not persist those route-check queries; keep protected-route observers on their shared key so offline ledger behavior remains unchanged.
