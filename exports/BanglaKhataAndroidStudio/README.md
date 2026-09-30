# BanglaKhata Android Studio project

A standalone Java Android app that opens the live BanglaKhata website,
**https://banglakhata.com/**, in an Android WebView. It wraps the published
website; it does not include the website source, API server, or database.

## Open and build

1. Extract the ZIP file.
2. In Android Studio, open the extracted `BanglaKhataAndroidStudio` folder
   (the folder containing `settings.gradle`).
3. Set the Gradle JDK to **JDK 17**. If prompted, install **Android SDK Platform
   35** and allow Gradle Sync to download dependencies.
4. Select **Build → Build Bundle(s) / APK(s) → Build APK(s)**. The debug APK is
   written to `app/build/outputs/apk/debug/app-debug.apk`.

No Expo Go or separate application command-line setup is required. The included
Gradle wrapper is available for developers who prefer `./gradlew assembleDebug`
or `gradlew.bat assembleDebug`.

## Included behavior

- Loads the production site over HTTPS and keeps the WebView cookie/storage
  profile between app launches. Cookies are accepted, flushed after navigation
  and when the app pauses, and are used by authenticated downloads.
- Runs the site's existing sign-in, sign-out, ledger, and entry flows inside the
  WebView. Login/session policy remains controlled by the website and its
  identity providers.
- Supports selecting an existing bill photo or taking a new photo from the
  Android file chooser.
- Handles authenticated HTTPS downloads with Android DownloadManager and the
  current WebView cookies.
- Bridges generated PDF/blob downloads to Android storage and the system share
  chooser. Generated-file transfers are limited to 64 MiB; single-file sharing
  is supported.
- Provides Android back navigation, a loading indicator, and an offline retry
  screen.

## Login note

Phone OTP and email/password sign-in use the website's existing WebView flow.
Google and other social-login providers may reject sign-in from an embedded
WebView. This wrapper does not change the website's OAuth configuration or add
native Google authentication; if Google sign-in is blocked, use phone OTP or
email sign-in.

## Requirements and security

- Android Studio with JDK 17, Android SDK Platform 35, and an internet
  connection for the first Gradle sync.
- Android 7.0 (API 24) or newer.
- The live website and its API must remain online; the app is not an offline
  copy of the service.
- HTTPS is required. Cleartext traffic and mixed content are disabled, and TLS
  certificate errors are not bypassed.
- No API keys, private signing keys, local SDK paths, Gradle caches, or build
  outputs are included.

## Checks performed for this ZIP

- The live production URL responded successfully when checked.
- The included JavaScript download-bridge test can be run with
  `node tests/bridge.test.cjs`.
- This Replit environment has no Android SDK configured, so an APK could not be
  built here. Open the project in Android Studio to perform the actual Android
  SDK compilation and device testing.

Before release, test login/logout, app restart with an active session, bill
photo camera/gallery selection, ledger entries, generated reports, authenticated
downloads, Android Back, and offline recovery on a physical device or emulator.