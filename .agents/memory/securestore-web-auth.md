---
name: Expo SecureStore on web
description: Why Expo SecureStore can crash in Expo web previews and how to keep browser OTP sessions cookie-backed.
---

Expo SecureStore's web entry exports an empty module. Its public `getItemAsync` wrapper calls the private native bridge method `getValueWithKeyAsync`, which is valid for native builds but unavailable on web. Do not rename or patch this dependency-internal bridge method.

**Why:** Expo web previews can run the public storage wrapper before an unauthenticated OTP request, so the crash blocks the request even though app-owned code correctly uses `getItemAsync`.

**How to apply:** Keep SecureStore reads and writes on iOS/Android only. On web, do not persist bearer tokens in browser storage; rely on the server's HttpOnly phone-session cookie, enable browser credentials for cross-origin API fetches when needed, and keep the API CORS allowlist intact.