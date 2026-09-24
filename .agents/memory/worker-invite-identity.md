---
name: Worker invitation identity
description: Why invitations for a verified worker identity are globally exclusive while pending
---

Allow only one pending worker invitation per normalized verified identity across all businesses, even though workers receive access only to assigned parties in one business.

**Why:** Claiming a pending invitation at first sign-in has no unambiguous business selector. Two concurrent pending invitations for the same email could otherwise attach a worker to an arbitrary owner's ledger.

**How to apply:** If multiple-business staff membership is later requested, design an explicit invitation acceptance step and business selection before relaxing this constraint; a business-scoped duplicate check alone is insufficient.