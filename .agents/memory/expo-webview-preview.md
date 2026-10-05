---
name: Expo WebView browser preview
description: Platform split needed to preview a website container through Expo's browser-based development preview.
---

For `Platform.OS === 'web'`, display the target website in an iframe and keep native-only notification APIs behind a non-web platform guard; use `react-native-webview` for iOS and Android. The native WebView package can bundle successfully for web while leaving the page blank and never completing its load callback.

**Why:** Expo's browser preview renders a web bundle, where the native WebView renderer is not an actual browser frame and some notification methods throw as unsupported.

**How to apply:** Verify the iframe in the Expo browser preview and separately bundle the native platforms. Guard calls such as notification-response APIs from web effects. A successful Metro web bundle alone does not prove the website appears in the preview.