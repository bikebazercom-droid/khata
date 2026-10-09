---
name: Expo WebView contact access
description: Privacy boundary for phone contacts in shared web and native Expo UI.
---

For shared party-management flows rendered in an Expo WebView, phone contacts are not available to web code directly. Keep the picker in the shared web app and use the mobile shell only as a permission-gated contact provider: when the user opens the customer/supplier picker, request permission and load the device contacts. Never request access at app startup. Validate the message origin, return only contact names and phone numbers, and never persist the full address book. Manual entry must remain available when permission is denied or unavailable. Web browsers continue to use their Contact Picker only after an explicit tap.

**Why:** Opening the party picker is the user's action to add or find a party, while delaying access until then avoids prompting on app launch. The origin-checked bridge and name/phone-only response keep contact access limited to that flow.

**How to apply:** Extend this bridge for future contact-related features in the shared WebView rather than duplicating party screens. Do not add contact access to startup, background sync, or persistent address-book storage.
