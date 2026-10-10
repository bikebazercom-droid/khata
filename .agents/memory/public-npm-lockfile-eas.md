---
name: Public npm lockfiles for EAS
description: Keep npm lockfiles portable when Expo cloud builds install from this Replit workspace.
---

Any `package-lock.json` used by EAS must contain public `https://registry.npmjs.org/` tarball URLs. In this workspace, `npm install --package-lock-only --registry=...` can preserve absolute `package-firewall.replit.internal` URLs from cached package metadata, so inspect every `resolved` entry after regeneration. Set the project's npm registry to npmjs and pin EAS Node to the package's declared engine.

**Why:** Expo cloud workers cannot resolve Replit's internal package firewall, and a successful local install can hide those non-portable URLs.

**How to apply:** Regenerate the lock, verify no Replit-internal hostname remains, and test `npm ci` in a clean temporary directory with public-registry access before relying on EAS.
