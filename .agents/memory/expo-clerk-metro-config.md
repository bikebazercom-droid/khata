---
name: Expo + Clerk Metro config fix
description: Metro crashes watching a non-existent @clerk/backend temp directory on startup; requires a blockList entry.
---

# Expo + Clerk Metro blockList Fix

## The Rule
When adding `@clerk/expo` to an Expo project, always add a Metro `blockList` entry for `@clerk/backend_tmp_*` directories.

**Why:** `@clerk/backend` creates ephemeral temp directories (named `@clerk/backend_tmp_NNN`) at startup that are cleaned up before Metro finishes its initial file-system crawl. Metro then tries to watch a path that no longer exists and crashes with `ENOENT`.

**How to apply:** In `metro.config.js`:

```javascript
const clerkTmpPattern = /node_modules\/@clerk\/backend_tmp_\d+/;
// merge with any existing blockList
config.resolver.blockList = [clerkTmpPattern, ...(existingPatterns)];
```

The fix lives in `artifacts/khatabook-mobile/metro.config.js`.
