---
name: Orval and Zod format compatibility
description: Avoid schema formats that generate validators unsupported by the workspace Zod version.
---

OpenAPI `format: uuid` and `format: email` on schema fields currently make Orval emit `zod.uuid()` and `zod.email()`, which are unavailable in this workspace's Zod 3 runtime. Keep those fields as strings and rely on the existing server validation unless the generator is fixed or Zod is upgraded.

**Why:** Code generation completed but the library typecheck failed because the generated Zod methods did not exist in the installed version.

**How to apply:** Before adding UUID or email formats to schema fields, verify that the current codegen output compiles; do not change runtime dependency versions just to preserve OpenAPI format annotations.