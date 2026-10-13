---
name: Expo Go remote notifications
description: Avoid unsupported expo-notifications remote-push paths in SDK 53+ Expo Go and development previews.
---

Do not load or call the `expo-notifications` runtime in Expo Go/web development previews. SDK 53+ Expo Go removes remote push support, and this can throw rather than merely return an unavailable token. Keep native push registration available in production native builds.

**Why:** This mobile app logged SDK exceptions during preview startup when the notifications runtime was reached, even though the Expo Go token path was expected to be caught.

**How to apply:** Guard the runtime import and every notification API call before importing the package. Keep only type-level imports at module scope; report push as unavailable in previews and retain handling in production native builds.
