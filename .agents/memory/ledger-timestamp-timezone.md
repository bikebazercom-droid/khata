---
name: Ledger timestamp timezone
description: User-facing timezone behavior for transaction timestamps in BanglaKhata.
---

Display transaction timestamps in the viewer's local timezone across party history, detail views, and statement PDFs, using a 12-hour clock with AM/PM. For each entry, use `dueDate` as the calendar date when present and fall back to the local date of `createdAt`; append the local time from `createdAt`. Keep `dueDate` semantics unchanged because it is a business calendar date, not an instant to shift.

**Why:** The user explicitly wants timestamps to match the viewer's current region, not a fixed UTC display; shifting a date-only due date would change an intentionally backdated transaction date. Paired transfers must also preserve the selected business date on both ledger entries or the counterparty side falls back to its creation date.

**How to apply:** Share the same date/time formatter between party history and statement PDFs. Use local-time formatting for `createdAt` instants and consistently render a 12-hour time with AM/PM. Leave calendar-only due dates unshifted, and store a transfer's selected `dueDate` on both linked entries. Verify formatting under multiple non-UTC `TZ` values.