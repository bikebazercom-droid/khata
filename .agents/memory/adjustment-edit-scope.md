---
name: Adjustment editing scope
description: Product boundary for editing ledger adjustment entries.
---

The transaction edit screen must expose the same adjustment control as entry creation. Users may convert a regular entry to an adjustment, retarget an existing adjustment, or remove its link. Removing a link must confirm that the paired row will be deleted and both balances recalculated; the server must apply pair changes atomically and enforce same-business, same-role, and staff-grant checks.

**Why:** The user later changed the earlier fixed-party restriction and explicitly requested link, retarget, and adjustment controls while editing.

**How to apply:** Keep the edit and create flows aligned. Treat the primary entry, counter-entry, and every affected party balance as one transaction; require confirmation before unlinking.
