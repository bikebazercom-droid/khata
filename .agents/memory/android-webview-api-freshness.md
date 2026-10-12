---
name: Android WebView API freshness
description: Prevent stale API list data in Android WebViews while keeping offline data in the app's query cache.
---

Do not force Android WebView into `LOAD_CACHE_ELSE_NETWORK` for apps that use API GETs. It can return stale HTTP-cached responses after a successful POST and React Query invalidation. Keep normal HTTP cache semantics and set `cache: 'no-store'` on freshness-sensitive API list reads; React Query and the app's offline persistence should own local offline data.

**Why:** The mobile party-create request can succeed on the server, but the subsequent list refetch may still read an old HTTP-cache entry on Android. A WebView reload is unnecessary and risks losing local state.

**How to apply:** For other WebView-backed apps, separate shell/offline asset caching from API response caching. Keep offline data in the query/persistence layer, and make actively invalidated list fetches bypass native WebView HTTP caches.
