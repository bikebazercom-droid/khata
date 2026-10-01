---
name: API integration test concurrency
description: Reliability caveat for database-backed API integration test suites.
---

Run the API server's database-backed integration suites without file-level parallelism for a trustworthy aggregate result. Set Vitest's `fileParallelism` to `false`; `singleFork` alone is not enough. If a run fails, rerun the failing suite alone before changing application code.

**Why:** API tests share mutable PostgreSQL fixtures and persistent rate-limit counters. Parallel files can interfere with one another; a suite that still fails alone is a separate issue to investigate rather than an automatic consequence of parallelism.

**How to apply:** When validating broad API changes, serialize file execution and rerun any remaining failing suite by itself. Do not attribute an isolated failure to another test file.