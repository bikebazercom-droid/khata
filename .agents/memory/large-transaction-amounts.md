---
name: Large transaction amount layout
description: Required layout behavior for large currency values in party-history cards.
---

Keep complete formatted debit and credit amounts on one line inside the red/green party-history card columns, including crore- or billion-sized values. Adjust the amount font size to its content length; do not wrap, clip, or overflow the card.

**Why:** The user reported that wrapping large amounts into multiple lines distorts the transaction cards and clarified that amounts must stay on a single line.

**How to apply:** Constrain the amount grid tracks and size each amount to fit its available width. Check both debit and credit columns at mobile widths; running-balance text remains in the transaction details column.