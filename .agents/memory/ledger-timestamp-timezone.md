---
name: Ledger timestamp timezone
description: User-facing timezone behavior for transaction timestamps in BanglaKhata.
---

Display transaction creation times in UTC in both party-history rows and transaction details. Keep `dueDate` semantics unchanged because it is a business calendar date, not an instant to shift.

**Why:** The user explicitly wants UTC rather than each viewer's local timezone; shifting a date-only due date would change an intentionally backdated transaction date.

**How to apply:** Use an explicit UTC timezone when formatting `createdAt` times in transaction history and detail views. Preserve each view's existing date and 24-/12-hour presentation. Verify with tests under a non-UTC `TZ`.