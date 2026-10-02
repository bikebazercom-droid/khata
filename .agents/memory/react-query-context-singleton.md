---
name: React Query context singleton
description: Keep QueryClientProvider and generated hooks connected across pnpm workspace package links.
---

Keep `@tanstack/react-query` as a peer dependency so consumers can share their provider context. `@workspace/api-client-react` also needs the same catalog entry in `dependencies`; Hostinger failed to resolve its imports when the package was peer-only. Consumers should retain direct dependencies, and Vite apps should list React Query in `resolve.dedupe`.

**Why:** pnpm can create separate peer-instantiated React Query copies for different React versions. Those copies create distinct React context objects even when the React Query package version is identical, so hooks can throw “No QueryClient set” while a provider is visibly mounted. Hostinger also needs a direct dependency to resolve the library import in its production build.

**How to apply:** Keep the dependency and peer dependency on the same catalog version, align linked consumers to their React Query instance, and use Vite dedupe. Verify a generated hook under the app provider and run the workspace build.