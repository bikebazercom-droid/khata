---
name: Firebase authentication migration
description: Chosen web/mobile providers and identity-linking constraints for BanglaKhata.
---

Use Firebase Authentication for web Google sign-in. The Android app should use native Google OAuth in the system browser and return the Google ID token to the same-origin WebView for Firebase exchange and its existing server-backed session; keep phone OTP available too. Link imported owner/staff accounts only by a unique verified email. Preserve original imported identity IDs and existing ledger access.

**Why:** The user chose to replace Clerk after Hostinger sign-in refresh failures, confirmed imported users kept their original IDs, selected verified-email linking, and later chose native Google login in the Android app after Google auth rendered a blank screen inside its WebView.

**How to apply:** Keep browser Google sign-in, Android native Google OAuth, and phone OTP paths distinct. The Android build needs the registered Android and Web OAuth client IDs at build time. Preserve the legacy identity column; production also needs Firebase authorized-domain/configuration and the additive `firebase_uid` schema migration before release. Vite bakes `VITE_FIREBASE_*` into the static bundle at build time, so Hostinger must provide them during the root `build:hostinger` command. Preflight the deployed key with Firebase Auth; a nonempty key can still be invalid. Rebuild/redeploy the API from current main after auth changes; a restart alone may leave the old compiled Clerk middleware running.
