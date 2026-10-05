---
name: Android export validation
description: Verification boundaries and local SDK/toolchain pitfalls for Android builds.
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

For the current Expo mobile app, the local Nix SDK initially contained only
Android API 35, while Expo's generated project targets API 36 and Build Tools
36.0.0. Install the required components in a writable SDK root rather than
lowering the app's compile SDK.

**Why:** The generated project's Gradle configuration explicitly selects API 36;
configuration alone does not ensure that the platform and build tools exist.

**How to apply:** Check the generated project's requested SDK versions and make
them available before attempting release assembly.

A full release attempt under OpenJDK 17 and a retry under OpenJDK 21 crashed
inside libjvm with SIGBUS during Gradle operations, including after reducing
Gradle concurrency. The crashes occurred at different JVM frames and produced
no APK.

**Why:** Reproducing across two supported Java versions points to a workspace or
host-level problem rather than one JDK patch or broken application source.

**How to apply:** Avoid repeating the same local build setup. Use another
supported build environment, then require a successful release assemble and
verify the APK signature before delivery.