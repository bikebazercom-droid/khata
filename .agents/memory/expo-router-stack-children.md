---
name: Expo Router Stack children
description: Expo Router Stack's direct-child mapping behavior and safe conditional screen registration.
---

Expo Router's Stack route mapper expects `Stack.Screen` elements (and supported Stack components) as its children. A React fragment passed directly inside `Stack` is treated as an unknown child; in the current SDK 57 dependency set, warning formatting the fragment's symbol type can throw `Cannot convert a Symbol value to a string`.

**Why:** Conditional nested fragments caused the mobile preview to fail at startup while rendering `RootLayoutNav`.

**How to apply:** For conditional routes, render each `Stack.Screen` directly or supply a conditional array of screen elements. Do not wrap route elements in a fragment inside `Stack`.
