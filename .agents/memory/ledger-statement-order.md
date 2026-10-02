---
name: PDF statement order
description: Date ordering and balance behavior for party statement PDFs.
---

Use the transaction business date (`dueDate`, falling back to local `createdAt` date) for statement filtering, opening-balance boundaries, row order, and date groups. Show rows newest-first, later-created entries first within a day, while calculating balances chronologically oldest-to-newest; attach the opening-balance note to the earliest included date group.

**Why:** Backdated entries were being filtered and grouped by different dates because range calculations used `createdAt` while statements displayed `dueDate`. The user requested current dates first and correct period membership.

**How to apply:** Use `getLedgerEntryDateKey` consistently for period bounds, opening-balance inclusion, sorting, and grouping. Include entries on the selected start/end days, keep equal-day rows contiguous, and retain chronological balance calculations before reversing for display.