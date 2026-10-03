---
name: Mobile party-list parity
description: Keep Expo/native while using the website as the BanglaKhata mobile parity reference.
---

For BanglaKhata, preserve the Expo/native app architecture and use the website as the reference for mobile features, flows, and styling. Mirror website behavior in Expo instead of replacing the website or migrating both apps to a shared cross-platform UI. Use native equivalents for device-specific controls such as camera, sharing, and date pickers. Check existing mobile entry points before treating an absent route as a missing feature.

For the mobile initial screen, keep the website's customer/supplier party-list structure: customer/supplier tabs, role-specific balance summary, search/filter/report controls, party rows, add-party action, and Customers/Settings bottom navigation. Do not restore a separate dashboard as the mobile landing page.

**Why:** The user chose to keep Expo and bring mobile to website feature and design parity.

**How to apply:** For each feature change, compare the website's behavior and styling with all mobile entry points, then adapt it using native routing and platform UI. Keep the website as the reference; do not start a broad shared-UI migration.