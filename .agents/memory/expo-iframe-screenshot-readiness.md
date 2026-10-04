---
name: Expo iframe screenshot readiness
description: Why Expo Web visual tests must wait for both the embedded page and the wrapper to finish rendering.
---

Wait for both the target content inside an Expo Web iframe and the app wrapper's loading state to clear before capturing. A visible target element inside the iframe is not sufficient.

**Why:** The iframe content can become queryable before the wrapper handles its load event and removes its full-screen spinner. Capturing at that point compares the spinner instead of the embedded screen and produces false visual differences.

**How to apply:** Screenshot comparisons for Expo Web should wait for route-specific iframe content and for the wrapper's loading and error overlays to disappear before taking the screenshot.