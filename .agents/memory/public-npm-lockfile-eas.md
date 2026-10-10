---
name: Expo monorepo build root
description: Keep cloud Expo builds pointed at the nested mobile app and the workspace's pnpm dependency graph.
---

The Expo app lives under `artifacts/khatabook-mobile`; the workspace root `app.json` and `eas.json` describe a different placeholder project. Cloud builds must target the mobile artifact's project configuration. This monorepo is managed by pnpm, and its `pnpm-lock.yaml` has no Replit-private tarball URLs. A root `package-lock.json` takes precedence in cloud install detection, can contain private Replit URLs, and makes the wrong package manager run.

**Why:** Replit's workspace root is not the BanglaKhata Expo app root, and an npm lock generated inside Replit can point outside the cloud worker's network.

**How to apply:** Keep Expo dependencies in the mobile artifact, use the root `packageManager: pnpm` and workspace lock, and select `artifacts/khatabook-mobile` as the cloud build project root.
