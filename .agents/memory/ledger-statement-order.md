---
name: PDF statement order
description: Date ordering and balance behavior for party statement PDFs.
---

Use the transaction business date (`dueDate`, falling back to local `createdAt` date) for statement filtering, opening-balance boundaries, row order, and date groups. Show statement PDF rows oldest-first, earlier-created entries first within a day, and calculate balances in that same chronological order; attach the opening-balance note to the first (earliest) included date group. Keep the live party history's newest-first presentation independent.

**Why:** Backdated entries were being filtered and grouped by different dates because range calculations used `createdAt` while statements displayed `dueDate`. The user has since explicitly requested chronological oldest-first order in statement PDFs.

**How to apply:** Use `getLedgerEntryDateKey` consistently for period bounds, opening-balance inclusion, sorting, and grouping. Include entries on the selected start/end days, keep equal-day rows contiguous, and render the chronologically accumulated rows without reversing them.