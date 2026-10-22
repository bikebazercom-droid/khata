---
name: Auth-safe shell updates
description: Keep service-worker shell updates from interrupting active sign-in or authenticated sessions.
---

Do not force a browser reload when a service-worker shell update activates during sign-in or an authenticated session. Let the worker cache the new shell while the current document and session continue; normal future navigation can load the updated shell.

**Why:** Deferring a shell reload only until login completes can interrupt the freshly created session and cause repeated splash/dashboard transitions.

**How to apply:** For the web/PWA auth flow, avoid reloads from shell-version messages or route changes. Validate OTP and Clerk sign-in without forcing a page reload.
