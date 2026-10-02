---
name: Party-role report and transfer scope
description: Product rule for keeping supplier and customer data separate in reports and adjustments.
---

Party role is a hard scope boundary: a supplier report contains only supplier ledger entries, and an adjustment or transfer must target a party with the same role as its source. Enforce this in both the interface and API, while preserving business-level isolation.

**Why:** Supplier and customer contexts must remain distinct, and the user explicitly required preserving the existing multi-business isolation behavior.

**How to apply:** Carry the active role through report and adjustment-target queries, filter report results defensively, derive adjustment role from the source party, reject cross-role transfers server-side, and keep business IDs in the existing query/cache scoping mechanism.