---
name: Orval codegen recovery
description: Generated API folders are cleaned before Orval validates its input.
---

After changing an OpenAPI contract, run codegen and confirm it succeeds before typechecking or editing generated imports. A failed Orval run can leave generated folders empty even though the source contract remains.

**Why:** Orval cleaned the React client and Zod generated outputs before reporting an invalid input, temporarily removing imports needed by the workspace.

**How to apply:** If codegen fails, repair the OpenAPI/config input and rerun codegen immediately; do not continue with partially cleaned generated files.
