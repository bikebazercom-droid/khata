---
name: Expo + Clerk Metro config fix
description: Metro crashes watching non-existent ephemeral directories; requires blockList entries for both @clerk/backend_tmp_* and Replit .local/skills paths.
---

# Expo Metro blockList Fixes

## The Rule
Always block ephemeral paths in `metro.config.js` for this project:

1. **Clerk temp dirs** — `@clerk/backend` creates `@clerk/backend_tmp_NNN` directories at startup that are deleted before Metro finishes crawling.
2. **Replit `.local/skills` dirs** — Replit can rename/delete skill directories while Metro is actively watching them (e.g. `.old-design-exploration-NNN` stubs), causing an `ENOENT` crash.
3. **pnpm transient store dirs** — `.local/share/pnpm/_tmp_*` directories can disappear during a Metro crawl and trigger the same watcher failure.

**Why:** Metro's `FallbackWatcher` calls `fs.watch()` on every path it discovers. If any path disappears between discovery and the `watch()` call, Metro crashes with `ENOENT: no such file or directory, watch <path>` and exits with code 7.

**How to apply:** In `metro.config.js`:

```javascript
const blockPatterns = [
  /node_modules\/@clerk\/backend_tmp_\d+/,
  /\/\.local\/skills\//,
  /\/\.local\/skills\b/,
  /\/\.local\/share\/pnpm\/_tmp_[^/]+/,
];
config.resolver.blockList = [...blockPatterns, ...(existingPatterns)];
```

These patterns are present in `artifacts/khatabook-mobile/metro.config.js`. If Metro crashes with `ENOENT` on another ephemeral Replit-managed path, add a matching regex to `blockPatterns` and restart the workflow.
