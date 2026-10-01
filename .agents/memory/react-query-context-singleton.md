---
name: React Query context singleton
description: Keep QueryClientProvider and generated hooks connected across pnpm workspace package links.
---

Workspace libraries that export React Query hooks should declare `@tanstack/react-query` as a peer dependency, not a regular dependency. Each consuming app must depend on React Query directly, and Vite apps should list it in `resolve.dedupe`.

**Why:** pnpm can create separate peer-instantiated React Query copies for different React versions. Those copies create distinct React context objects even when the React Query package version is identical, so hooks can throw “No QueryClient set” while a provider is visibly mounted.

**How to apply:** When a linked workspace library exports generated query or mutation hooks, align it to the consumer's React Query instance. Verify the production bundle includes only one React Query context factory and test a generated hook under the app's provider.