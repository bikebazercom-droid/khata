---
name: Filtered pnpm lockfile updates
description: Avoid pruning unrelated dependencies from the shared workspace lockfile.
---

Do not regenerate the shared `pnpm-lock.yaml` with a filtered `pnpm install --lockfile-only` in this monorepo unless pruning unrelated workspace snapshots is intended.

**Why:** A filtered run can remove package and snapshot entries used by workspace projects outside the selected filter. A later full install may not restore those unused entries, leaving a broad, noisy lockfile diff.

**How to apply:** Start from the intended base lockfile, run `pnpm install --lockfile-only --no-frozen-lockfile --ignore-scripts` for the full workspace, then verify with `pnpm install --lockfile-only --frozen-lockfile --ignore-scripts`.