---
name: Phone OTP independent of Clerk
description: Keep custom SMS OTP sessions usable when the Clerk browser SDK is delayed or unavailable.
---

Treat a successful `/api/auth/me` response with `authMethod: "phone"` as a server-verified session even while Clerk's client SDK is still loading. Phone OTP is a separate server-cookie flow and must not be blocked by Clerk initialization.

**Why:** A Clerk custom-domain or SDK loading problem must not leave a valid phone login on an endless splash screen.

**How to apply:** Keep server-side phone-session validation enabled independently of Clerk `isLoaded`; continue honoring authoritative 401/403 responses so revoked sessions are not trusted.
