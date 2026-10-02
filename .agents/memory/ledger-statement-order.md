---
name: PDF statement order
description: Date ordering and balance behavior for party statement PDFs.
---

Show party statement rows and date groups newest-first by transaction business date (`dueDate`, falling back to local `createdAt` date). Within one business date, show later-created entries first. Calculate running balances chronologically from oldest to newest, then reverse the completed rows for display; attach the opening-balance note to the earliest date group.

**Why:** The user reported that backdated statement entries appeared in mixed date order and requested current dates first.

**How to apply:** Sort and group using the shared business-date key. Keep equal-day rows contiguous, retain chronological balance calculations, and render date headers in the same order as their rows.