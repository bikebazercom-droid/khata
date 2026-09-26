# BanglaKhata — Fresh Android Studio Project

This is a standalone Java Android app that displays the published BanglaKhata
website in a full-screen native WebView.

## Build without changing code

1. Extract this ZIP.
2. In Android Studio **Meerkat 2024.3.1 or newer**, choose **Open** and select
   the `BanglaKhataAndroid` folder containing `settings.gradle`.
3. Allow Gradle Sync and any Android SDK download prompts to finish.
4. Use **JDK 17** for Gradle (Settings → Build, Execution, Deployment →
   Build Tools → Gradle → Gradle JDK). Do not use the old GraalVM Java 19.
5. Select **Build → Generate App Bundles or APKs → Generate APKs**.
   Depending on Android Studio version, the menu may instead be named
   **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
6. Find the APK at `app/build/outputs/apk/debug/app-debug.apk`.

Alternatively, run from the project root:

Windows:
```bat
gradlew.bat assembleDebug
```

macOS / Linux:
```sh
chmod +x gradlew
./gradlew assembleDebug
```

Android Studio supplies your local SDK path automatically. No application code
needs to be written or repaired. Internet access is required for the initial
Gradle, dependency and SDK downloads.

## Already-built test APK

`test-apk/BanglaKhata-debug.apk` is built from these sources. You can copy it to
an Android 7.0+ phone and allow installation from your file manager to test it.
This is a debug APK, not a Play Store production release.

## Verified build

- Gradle 8.11.1, Android Gradle Plugin 8.9.2.
- OpenJDK 17, Android SDK Platform 35 and Build Tools 35.0.0.
- `assembleDebug`: **BUILD SUCCESSFUL**.
- `lintDebug`: **0 errors**, 4 non-blocking warnings.
- APK signature verification: passed.
- No emulator or physical-device test has been performed.

## Included

- Project/module `build.gradle` and `settings.gradle`.
- Official Gradle wrapper scripts, JAR and checksum-pinned distribution.
- INTERNET and ACCESS_NETWORK_STATE manifest permissions.
- `MainActivity.java`, XML layout, icon, strings and theme.
- JavaScript and DOM Storage enabled.
- WebViewClient keeps web navigation inside the app.
- Immersive full screen, keyboard insets, Android Back navigation, loading
  indicator, file picker, persistent cookies and a network retry screen.
- AndroidX dependencies and a Kotlin runtime BOM to prevent transitive
  duplicate-class build errors. The app source itself is Java.

## Website and security

The configured website is **https://hazarikhata.replit.app/**.
The app loads the live website; the backend/database are not embedded in the
APK. The website and internet connection must remain available.

HTTPS page links remain inside the app. Telephone, email and SMS actions open
the matching device apps. Cleartext HTTP and invalid TLS certificates are
blocked rather than bypassed.

Google and other social-login providers may restrict embedded browsers.
This wrapper cannot override provider policies. Use a supported email login
and verify your business workflows on a phone before production use.
Native camera capture, JavaScript blob/PDF download bridges, and offline
server/database operation are not provided by this simple WebView project.

No passwords, API keys, private signing keys, machine-specific SDK paths or
Gradle caches are included. Newer Android Studio versions may suggest plugin
upgrades; the included pinned versions do not need upgrading to build this ZIP.