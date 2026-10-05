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

In the shared, memory-limited workspace, cap Metro's Node heap at 1 GiB and keep
CMake at one compiler, but preserve the Android project's 2 GiB Gradle heap.
Reducing Gradle to 1 GiB let Metro finish but caused D8's dex merge to fail with
Java heap exhaustion; the project's configured 2 GiB heap completed release
assembly.

**Why:** The 8 GiB container also runs the app workflows. Node's uncapped heap
was externally killed during Metro bundling, while an over-reduced Gradle heap
starved D8, which runs in Gradle's no-isolation worker.

**How to apply:** For local release builds, use `NODE_OPTIONS=--max-old-space-size=1024`,
`CMAKE_BUILD_PARALLEL_LEVEL=1`, one Gradle worker, and the project's existing
`-Xmx2048m` setting. Verify package metadata and the signing certificate with
`aapt` and `apksigner`.

Info-ZIP `unzip -t` reported zero-length extra-field warnings for the verified
APK even though `aapt` parsed it, `apksigner` accepted it, and Python's ZIP CRC
test passed.

**Why:** Generic ZIP tooling can misreport Android APK extra fields.

**How to apply:** Treat Android's APK tools and an entry CRC check as stronger
validation than `unzip -t` alone.