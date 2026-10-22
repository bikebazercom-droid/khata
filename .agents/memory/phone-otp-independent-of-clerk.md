---
name: Phone OTP independent of Clerk
description: Keep custom SMS OTP sessions usable when the Clerk browser SDK is delayed or unavailable.
---

Treat a successful `/api/auth/me` response with `authMethod: "phone"` as a server-verified session even while Clerk's client SDK is still loading. Phone OTP is a separate server-cookie flow and must not be blocked by Clerk initialization.

The Expo WebView may start at `/sign-in` because it has no Clerk-native token for a phone session. That route must still check the server cookie and redirect an already-authenticated phone user to the ledger; keep the sign-in form available while an unauthenticated check is pending.

**Why:** A Clerk custom-domain or SDK loading problem must not leave a valid phone login on an endless splash screen.

**How to apply:** Keep server-side phone-session validation enabled independently of Clerk `isLoaded`; make public sign-in routes redirect only after a successful server response, and continue honoring authoritative 401/403 responses so revoked sessions are not trusted.
