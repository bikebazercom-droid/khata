---
name: Expo Contacts SDK migration
description: Expo SDK 57's contacts package deprecates the old root-level async API at runtime.
---

In Expo SDK 57, legacy methods such as `getContactsAsync` imported from `expo-contacts` deliberately throw at runtime. Keep the old contacts query implementation only when importing from the explicit `expo-contacts/legacy` subpath; permission requests and paginated contact reads remain available there.

**Why:** Permission can be granted correctly while every actual contact query still fails, making this look like a device permission or native build problem.

**How to apply:** When maintaining code that uses `Fields`, `getContactsAsync`, or other legacy Contacts methods, use `expo-contacts/legacy`; otherwise migrate fully to the new class-based `Contact` API.
