---
name: Large transaction amount layout
description: Required layout behavior for large currency values in party-history cards.
---

Keep complete formatted debit, credit, and running-balance values inside party-history cards at narrow phone widths, including crore- or billion-sized amounts. Prefer wrapping or responsive sizing over clipping or truncation.

**Why:** The user reported large values overflowing card boundaries and requested that amounts of any length remain inside the card.

**How to apply:** Constrain the amount grid tracks and allow values to shrink or wrap. Check both debit/credit amounts and running-balance text at mobile widths.