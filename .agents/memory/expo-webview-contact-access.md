---
name: Expo WebView contact access
description: Privacy boundary for phone contacts in shared web and native Expo UI.
---

For shared party-management flows rendered in an Expo WebView, phone contacts are not available to web code directly. Keep the picker in the shared web app and use the mobile shell only as a permission-gated contact provider: ask after an explicit import tap, validate the message origin, return only contact names and phone numbers, never persist the full address book. Manual entry must remain available when permission is denied or unavailable.

**Why:** The shared website is the source of truth for web and mobile screens, while native contact access requires iOS and Android permissions. This keeps the screens aligned and limits contact-data exposure.

**How to apply:** Extend this bridge for future contact-related features in the shared WebView rather than duplicating party screens or reading contacts at app startup.
