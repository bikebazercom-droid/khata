---
name: Website source of truth for mobile
description: The user's required architecture and behavior parity between BanglaKhata web and mobile.
---

The website is BanglaKhata's single source of truth. Mobile must match its components, UI layout, entry flows, calculator modals, routes, styling, calculations, and multi-khata data isolation without separate mobile templates or custom product behavior. The user chose to load the site inside Expo with a WebView and asked to keep the earlier native source files intact for now.

**Why:** The user explicitly directed that mobile and web have no feature or behavior discrepancies and that the website remain the source of truth.

**How to apply:** Keep the website as the visible product UI in Expo; do not delete the unused native screens during this migration. Add native bridges only where a required device feature is unavailable in the website container.