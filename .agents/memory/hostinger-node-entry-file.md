---
name: Hostinger Node entry file
description: Correct Git deployment setting for the BanglaKhata Node server on Hostinger.
---

For this pnpm monorepo on Hostinger, build with `pnpm run build:hostinger`. If the deployment form has an **Entry File** field, set it to `artifacts/api-server/dist/index.mjs`; do not put `pnpm start` there. If Hostinger instead provides a shell **Start command** field, use `node --enable-source-maps artifacts/api-server/dist/index.mjs`. Keep `NODE_ENV=production` and `SERVE_FRONTENDS=true` set at runtime.

**Why:** Hostinger's Entry File is interpreted as a file path, while `pnpm start` is a package-manager command. The build can complete successfully and still fail when Hostinger attempts to launch that invalid entry.

**How to apply:** When a Hostinger deployment reports successful artifact builds but a failed deployment and names `pnpm start` as the entry file, correct the Entry File field, then redeploy and inspect runtime logs.