# Validation and limits

- Gradle 8.11.1 wrapper executed successfully.
- Android project configuration and task discovery succeeded.
- MainActivity Kotlin source compiled successfully against Android 15 API
  classes using a separate validation harness. That harness uses stand-ins for
  generated R and BuildConfig classes and is **not included in this ZIP**.
- Android XML manifest and resource files parsed successfully.
- ZIP integrity and required project paths were checked.

This is not a claim that an APK was assembled or tested on a phone. Android SDK
platform/build tools are not installed in the preparation environment.
Run `assembleDebug` in Android Studio's configured SDK environment.

Device verification checklist:

1. Full-screen display, keyboard input, rotation and Android Back navigation.
2. Email login, session persistence, logout and access restrictions.
3. Ledger create/edit/save flows against the published server.
4. File selection, reports and downloads required by your workflow.
5. Offline retry and return from the background.

Embedded-browser restrictions from Google and other OAuth providers remain.
No WebView wrapper can guarantee that every browser feature works unchanged.