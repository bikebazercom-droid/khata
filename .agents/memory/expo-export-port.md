---
name: Expo export port conflicts
description: Verify Expo bundles when another configured workflow owns Metro's default port.
---

When Expo export cannot use port 8081 because another workflow already owns it, set `RCT_METRO_PORT` to an available port (for example, 8082) for the export command. This lets Metro bundle web, iOS, and Android without stopping the other workflow.

**Why:** In this workspace, the mockup preview server occupies port 8081, while a normal Expo export can otherwise prompt to use another port and fail in a non-interactive build.

**How to apply:** Prefer `RCT_METRO_PORT=<available-port> expo export --platform all` for bundle verification before interrupting a running preview workflow. The mobile package's static-build wrapper probes and fetches `localhost:8081` directly, so changing `RCT_METRO_PORT` does not redirect that wrapper; use direct `expo export` for an alternate-port verification.