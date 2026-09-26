# BanglaKhata — Native Downloads Android Studio Project

A complete Java Android project loading **https://hazarikhata.replit.app/**
in an immersive WebView. No live website source was changed for this export.
Android 7.0 (API 24) or later is required. Internet and the published website
remain necessary; this does not embed the server or database.

## Open and build

1. Extract the ZIP and open its **BanglaKhataAndroid** folder in Android Studio
   Meerkat 2024.3.1 or newer.
2. Choose **JDK 17** as the Gradle JDK; allow SDK 35/build-tools downloads and
   Gradle sync. Android Studio supplies your local SDK path.
3. Build → Generate App Bundles or APKs → Generate APKs (menu wording varies).
4. The debug APK is `app/build/outputs/apk/debug/app-debug.apk`.

Command line (SDK configured locally):

```sh
chmod +x gradlew
./gradlew assembleDebug lintDebug
```

Windows: `gradlew.bat assembleDebug lintDebug`.

The included `test-apk/BanglaKhata-debug.apk` is built from these sources.
Allow installation from your file manager when testing on a phone. This is a
debug-signed test build, not a signed Play Store production release.

## Download and sharing behavior

- HTTPS server downloads use Android DownloadManager, the actual URL's cookies,
  the WebView user agent, public `Downloads/BanglaKhata`, and completion notifications.
  A start toast and native Open / Share / Done completion dialog are provided.
  Download IDs survive Activity/process recreation and are checked on resume.
- Generated PDF/blob downloads **never** go to DownloadManager. An AndroidX
  same-origin, main-frame-only WebMessageListener receives bounded chunks.
  Document-start JavaScript intercepts attached or detached anchor `.click()`,
  FileSaver synthetic click dispatch, normal DOM click, and `navigator.share`
  with a file. This covers the inspected website's html2pdf `.save()`, jsPDF
  `.save()`, direct blob anchors, and generated-PDF share callsites.
- A clicked blob is retained/read before immediate `URL.revokeObjectURL()`.
  Transfers are acknowledged sequentially: begin → chunks → end. Maximum generated
  file size: **64 MiB**; one active transfer; **48 KiB decoded chunks**; explicit
  bounds, sequence checks, errors, and a two-minute inactivity timeout.
- Android 10+ saves generated downloads through MediaStore Downloads using a
  pending entry until complete. Android 7–9 uses public Downloads with a queued
  runtime WRITE_EXTERNAL_STORAGE request. No chunk is sent before permission ACK.
  Denial cancels rather than silently saving elsewhere.
- Native `navigator.share({files})` supports **one file**, stages it in private
  cache, and opens Android's share chooser. It does **not** also write a duplicate
  into public Downloads. Share text is preserved (up to 4,000 characters).
  Share resolves when the file is staged and chooser handoff is scheduled; it
  cannot report whether WhatsApp/email ultimately delivered it or the user canceled.
- Open/share uses content URIs (MediaStore, DownloadManager, or scoped FileProvider)
  with read grants and ClipData. No `file://` URI is exposed.
- File names, MIME types, paths, IDs, message sizes and chunk offsets are validated.
  File IO and DownloadManager queries run on a worker. Partial generated files are
  removed on failure, navigation, timeout or Activity destruction. A persistent
  journal attempts cleanup after process death; OS/filesystem failures can still
  require manual cleanup. Completed share cache files expire on a later launch
  after 24 hours, not while the receiving app may still read them.

## WebView and security

JavaScript, DOM storage and file access are explicitly enabled. Universal access
and file-URL cross-origin access are explicitly disabled. HTTPS is required,
mixed content and cleartext are blocked, and TLS errors are not bypassed.
The bridge permits only `https://hazarikhata.replit.app`, additionally checks
native source origin, current top-level origin and main-frame status, and never
uses an unrestricted `addJavascriptInterface`.

If you change WEB_APP_URL in `app/build.gradle`, the native allowed origin is
derived from that value; keep it HTTPS and use a host you control.
Sign-in cookies, file upload picker, loading/error retry UI, Android back
navigation, immersive bars and keyboard/cutout insets are retained.

AndroidX WebKit is pinned to **1.12.1** for this compileSdk 35 project. The Kotlin
**1.9.24 BOM** is retained to keep transitive Kotlin artifacts aligned.

## Actual verification

- Gradle 8.11.1 / Android Gradle Plugin 8.9.2 / OpenJDK 17.
- Android platform 35 / build-tools 35.0.0.
- `assembleDebug lintDebug`: **BUILD SUCCESSFUL**.
- Lint: **0 errors, 5 non-blocking warnings** (pinned dependency updates,
  existing backup-rule recommendation and layout overdraw).
- APK signature checked with Android build-tools `apksigner`.
- `node tests/bridge.test.cjs`: passed. This focused Node VM harness checks
  immediate revoke, detached FileSaver dispatch, WeakRef fallback, chunk bytes
  and offsets, share-only behavior, permission ACK/denial protocol, bounds, and
  main-frame guard. It is a DOM/protocol simulation, **not** a native browser test.

## Device checks still required / limitations

No emulator or physical Android device was run here. A successful build and JS
simulation do not guarantee every OEM, Android System WebView version, PDF viewer
or share target behaves identically. Test on API 28 (grant and deny storage),
API 29+ (Downloads visibility), API 35, and a current Android System WebView:

1. Sign in and download party/full-ledger reports; verify PDF contents and names.
2. Download an authenticated HTTPS attachment; test both native Open and Share.
3. Share a PDF/receipt into WhatsApp/email; verify readable attachment and no
   duplicate public download. Also cancel the chooser.
4. Test immediate-revoke exports, repeated taps, a file over 64 MiB, low storage,
   navigation/rotation during transfer, backgrounding, app termination and restart.
5. Check login, Back, keyboard, offline retry and photo/file picker.

Generated transfers require the WebMessageListener feature in installed Android
System WebView. Without document-start support, a page-finished compatibility
injection is attempted with a visible update warning; scripts that captured DOM
methods earlier can evade this fallback. Without WebMessageListener, generated
downloads show an update requirement (ordinary HTTPS downloads still work).
Data URLs, worker-driven downloads, popup-only exports, multiple-file native share,
camera capture, and server offline operation are not implemented. Future website
download implementation changes may require bridge updates.

DownloadManager follows Android's network/auth/redirect behavior: expiring sessions,
POST-only downloads, unusual headers, cross-origin redirect cookies, or a server
returning an HTML login page instead of a PDF require server-side corrections.
The 64 MiB bridge limit is not a DownloadManager network-download size limit.
Social-login providers may prohibit embedded WebViews; use a supported email login.

No API keys, private release signing keys, local SDK paths, Gradle caches or
build directories are included. The included APK is the only compiled test artifact.