---
name: Website source of truth for mobile
description: The user's required architecture and behavior parity between BanglaKhata web and mobile.
---

The website is BanglaKhata's single source of truth. Mobile must match its components, UI layout, entry flows, calculator modals, routes, styling, calculations, and multi-khata data isolation without separate mobile templates or custom product behavior. The user chose to load the site inside Expo with a WebView and asked to keep the earlier native source files intact for now.

**Why:** The user explicitly directed that mobile and web have no feature or behavior discrepancies and that the website remain the source of truth. Native safe-area or keyboard offsets can duplicate the website's viewport handling and cause layout drift.

**How to apply:** Load the same website in Expo's browser iframe and the iOS/Android WebView. Do not add native safe-area or keyboard offsets around the website; disable automatic WebView content insets and let its CSS control responsive layout. Keep Android `adjustResize` so the site receives keyboard viewport changes. Preserve unused native source files, and add native bridges only for required device features unavailable in the website container.