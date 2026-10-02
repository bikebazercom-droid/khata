---
name: Ledger timestamp timezone
description: User-facing timezone behavior for transaction timestamps in BanglaKhata.
---

Display transaction creation times in the viewer's local timezone across party history, transaction lists, and detail views. Rely on the device/browser timezone so local offsets and daylight-saving changes are applied automatically. Keep `dueDate` semantics unchanged because it is a business calendar date, not an instant to shift.

**Why:** The user explicitly wants timestamps to match the viewer's current region, not a fixed UTC display; shifting a date-only due date would change an intentionally backdated transaction date.

**How to apply:** Use local-time formatting for `createdAt` instants while preserving each view's date and 24-/12-hour presentation. Leave calendar-only due dates unshifted. Verify formatting under multiple non-UTC `TZ` values.