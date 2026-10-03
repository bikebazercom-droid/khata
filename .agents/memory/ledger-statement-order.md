---
name: Web party PDF ordering
description: Business-date ordering and balance snapshots for the web single-party ledger PDF.
---

For the web single-party ledger PDF, use the transaction business date (`dueDate`, falling back to local `createdAt` date) for sorting and month groups. Render months and rows newest-first, with later-created entries first within a day. Calculate each entry's balance snapshot in chronological oldest-first order before reversing presentation; never recompute balances in display order. Treat other PDF renderers independently rather than assuming they share this order.

**Why:** Newer ledger periods should be easier to find, and changing PDF display order must not alter the chronological running balance attached to each entry.

**How to apply:** Use `getLedgerEntryDateKey` for business-date sorting and grouping. Compute balances oldest-first, then reverse only the rendered order; do not change filtering or balance calculations to achieve newest-first navigation.