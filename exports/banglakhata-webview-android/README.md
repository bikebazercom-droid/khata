# BanglaKhata — native Android WebView

This is a standalone Android Studio project, not the Expo application. It loads
the published BanglaKhata website at https://hazarikhata.replit.app/ in a
full-screen WebView. The Replit editor and its navigation are not included.

## Open and build

1. Extract the ZIP and open **BanglaKhataWebView** in Android Studio (the folder
   containing `settings.gradle.kts`).
2. Use Android Studio Meerkat 2024.3.1 or newer, with Gradle JDK 17 or 21.
3. Install **Android SDK Platform 35** from SDK Manager if prompted.
4. Allow Gradle Sync to download the pinned build plugins and Kotlin runtime.
5. Select **Build → Build App Bundle(s) / APK(s) → Build APK(s)**, or run:
   - Windows: `gradlew.bat assembleDebug`
   - macOS/Linux: `chmod +x gradlew && ./gradlew assembleDebug`
6. The debug APK is at `app/build/outputs/apk/debug/app-debug.apk`.

There is no additional application code to write. Android Studio manages the
local SDK path; do not copy another computer's `local.properties`.

## Included

- Project and module Gradle Kotlin DSL files.
- Gradle 8.11.1 wrapper scripts and JAR with distribution checksum.
- Android Gradle Plugin 8.9.2 and Kotlin 2.1.10, pinned in the project.
- Manifest with INTERNET and ACCESS_NETWORK_STATE permissions.
- Kotlin Activity, XML layout, strings, theme, and launcher icon.
- JavaScript, DOM Storage, persistent cookies, and an in-app WebViewClient.
- Immersive full-screen mode, back navigation, loading indicator, file picker,
  ordinary same-host HTTPS downloads, and an offline retry page.
- No embedded server credentials, signing keys, or private data.

## Important boundaries

This ZIP contains the Android wrapper source. It is **not an offline copy of the
server/database**. The website and API must remain published and reachable.
Initial Gradle setup also requires internet access for build dependencies.

HTTPS links stay inside the app. Phone, email, SMS and cleartext HTTP links are
delegated to other apps. SSL errors are never bypassed. Google and other social
login providers may reject embedded browsers; this wrapper cannot override their
policies. Test the website's supported email login on a real device.

File inputs open the Android file picker; direct camera capture and blob-based
PDF downloads are not implemented as native bridges. Those website features
must be tested separately before a production release.

The project is configured for Android 6+ (min SDK 23), compile SDK 35, and target
SDK 34. This is a testing project, not a claim of current Play Store eligibility.

To change the live website without editing code:

```sh
./gradlew assembleDebug -PwebAppUrl=https://your-domain.example/
```

Only an HTTPS URL is accepted. Use a stable published URL, not a Replit editor or
development preview URL.