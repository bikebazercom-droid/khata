---
name: Expo SDK 57 React versions
description: React peer-version constraint for the Khatabook mobile artifact on Expo SDK 57.
---

The SDK 57 mobile app uses React and React DOM 19.2.3. Do not restore a root-wide React 19.1.0 override; it can force incompatible React versions into Expo and React Native peer resolution. A package-scoped override was also unsuitable because Expo peers still resolved as 19.1.0.

Expo Doctor may also report a duplicate React when it scans the monorepo root's React 19.3.0 alongside the mobile package's local React 19.2.3. If the mobile package resolves 19.2.3 and Android/iOS exports succeed, do not change the mobile pin solely to silence that workspace-level warning.

**Why:** The SDK 57 package set expects React 19.2.3, while the older root overrides caused peer mismatches across the mobile dependency tree.

**How to apply:** Keep the mobile package's explicit React 19.2.3 versions and avoid workspace-wide React overrides. Verify future dependency changes with `expo install --check`, Expo Doctor, workspace typecheck, and platform exports; distinguish a root-scoped duplicate warning from the mobile package's actual resolution.