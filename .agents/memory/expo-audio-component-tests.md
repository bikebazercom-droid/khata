---
name: Expo Audio component tests
description: How to test mobile UI that consumes Expo Audio under this workspace's Vitest/jsdom configuration.
---

Mock `expo-audio` locally in component tests rather than importing its runtime implementation. The Expo async-require bootstrap expects Metro-only Fast Refresh modules that are not present in the mobile app's Vitest/jsdom environment; setting `__DEV__` alone does not make that bootstrap test-compatible.

**Why:** Importing the real package first failed on the missing `__DEV__` global, then on its Fast Refresh setup module. A small fake player lets tests verify component behavior without pulling Metro bootstrap code into Vitest.

**How to apply:** For tests of components that call `useAudioPlayer`, hoist a `vi.mock('expo-audio')` returning a player with a mutable `currentTime` and mocked `play()`. Keep actual native playback validation in Expo bundling or on-device checks.