---
name: Android export validation
description: Verification boundaries for downloadable Android Studio source projects.
---

Do not treat successful Gradle task discovery as proof that Android application
source compiles. If the Android SDK is unavailable, a separate Kotlin compiler
check against Android API classes can catch source errors, but it does not
validate AAPT resource generation, APK packaging, or device behavior.

**Why:** Gradle configuration can succeed while Activity code still contains
unresolved nested types or nullability errors. Exporting a ZIP after only task
discovery can therefore give users a project that fails its first compilation.

**How to apply:** Prefer a real assembleDebug build. Otherwise clearly label the
checks performed, validate resource XML and archive contents separately, and
do not claim an APK build or successful device test.

For builds in this environment, use an actual OpenJDK 17 installation rather
than the Java module's GraalVM Java 19 runtime.

**Why:** The GraalVM module can configure Gradle successfully but fail Android's
JdkImageTransform at compilation time. OpenJDK 17 completed the same SDK build.

**How to apply:** Set JAVA_HOME for the validation process only; never include
a Nix store path or a local SDK location in a downloadable Android project.