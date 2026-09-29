---
name: Expo mobile auth loading
description: Prevent indefinite account-verification screens in Expo clients and distinguish them from web sessions.
---

# Expo mobile auth loading

Treat a native Expo session as separate from the browser's web session. The user must sign in in Expo, even when the same account and backend are used.

Do not run identity-refresh polling until an identity is established. Keep the in-flight identity request stable across renders, bound token retrieval and account requests, and show sign-in or a retryable error instead of an endless spinner.

**Why:** A refresh loop combined with an unstable auth callback cancelled the initial identity request before it reached the API, leaving the app on a permanent loading screen.

**How to apply:** When Expo remains on account verification, check whether the identity request reaches the API. If it does not, inspect token retrieval and effect cancellation before changing server auth. Verify mobile sign-in separately from the web session.