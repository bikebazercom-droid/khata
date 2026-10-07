---
name: Adjustment editing scope
description: Product boundary for editing ledger adjustment entries.
---

When editing an existing adjustment, let users recalculate its amount and update details, but keep the linked party fixed. Ordinary ledger entries remain ordinary; do not provide edit-time conversion, retargeting, or removal of an adjustment link unless the user changes this decision.

**Why:** The user chose to keep the linked party fixed while editing; linked entries represent one paired movement across two balances.

**How to apply:** Show the existing linked party as read-only in edit mode and use pair-aware API updates so amount changes stay synchronized.
