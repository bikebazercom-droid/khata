---
name: Interactive PDF support contacts
description: Cross-device contact actions for support details embedded in generated PDF reports.
---

PDFs should provide separate direct-call (`tel:`), WhatsApp (`https://wa.me/`), and email (`mailto:`) links instead of relying on a custom JavaScript choice popup.

**Why:** PDF link annotations support external URI actions, not portable arbitrary JavaScript dialogs, and PDF viewers vary in their support for PDF actions.

**How to apply:** Keep both call and WhatsApp actions visibly available in the footer, and add link annotations for generated PDFs whose HTML anchors are otherwise rasterized.
