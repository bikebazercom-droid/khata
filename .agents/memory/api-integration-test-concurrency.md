---
name: API integration test concurrency
description: Reliability caveat for database-backed API integration test suites.
---

Run the API server's database-backed integration suites without file-level parallelism for a trustworthy aggregate result. If a parallel run fails, rerun the failing suite alone before changing application code.

**Why:** Parallel API test runs showed order-dependent fixture results, while the affected suites and the serialized full suite passed.

**How to apply:** Serialize file execution when validating broad API changes that touch shared database-backed tests. Treat isolated failures as test-isolation questions until confirmed serially.