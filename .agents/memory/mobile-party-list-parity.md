---
name: Website source of truth for mobile
description: The user's required architecture and behavior parity between BanglaKhata web and mobile.
---

The website is BanglaKhata's single source of truth. Mobile must match its components, UI layout, entry flows, calculator modals, routes, styling, calculations, and multi-khata data isolation without separate mobile templates or custom product behavior. This supersedes the earlier direction to keep an independently implemented Expo UI.

**Why:** The user explicitly directed that mobile and web have no feature or behavior discrepancies and that the website remain the source of truth.

**How to apply:** Prefer one shared implementation over copied web/mobile behavior. Before replacing the current mobile UI architecture, confirm the chosen approach when it changes whether screens run natively or inside a web container.