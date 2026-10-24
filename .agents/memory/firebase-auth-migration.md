---
name: Firebase authentication migration
description: Chosen web/mobile providers and identity-linking constraints for BanglaKhata.
---

Use Firebase Authentication for web Google sign-in and keep phone OTP in the mobile WebView. Link imported owner/staff accounts only by a unique verified email. Preserve original imported identity IDs and existing ledger access.

**Why:** The user chose to replace Clerk after Hostinger sign-in refresh failures, confirmed imported users kept their original IDs, and selected verified-email linking.

**How to apply:** Keep web Google and mobile phone OTP flows distinct. Preserve the legacy identity column; production also needs Firebase authorized-domain/configuration and the additive `firebase_uid` schema migration before release. Vite bakes `VITE_FIREBASE_*` into the static bundle at build time, so Hostinger must provide them during the root `build:hostinger` command. Preflight the deployed key with Firebase Auth; a nonempty key can still be invalid. Rebuild/redeploy the API from current main after auth changes; a restart alone may leave the old compiled Clerk middleware running.
