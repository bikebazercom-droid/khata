---
name: Firebase authentication migration
description: Chosen web/mobile providers and identity-linking constraints for BanglaKhata.
---

Use Supabase Auth for web Google sign-in. Keep the Android app on native Google OAuth in the system browser with its Firebase exchange and keep phone OTP available. Link imported owner/staff accounts only by a unique verified email. Preserve original imported identity IDs and existing ledger access.

**Why:** The user chose to replace the web Google flow with Supabase Auth while preserving native Android Google sign-in and phone OTP. Earlier account decisions preserve imported IDs and link only by unique verified email.

**How to apply:** Keep the web Supabase flow separate from Android's Firebase bridge and phone OTP. Retain existing account IDs and require verified-email matching when linking users across providers. The web flow also depends on Supabase's Google provider and production redirect allowlist.

Verified Google users can sign up on the web without admin preapproval.

**Why:** The user explicitly chose direct web sign-in for all verified Google accounts, not a one-off Gmail approval.

**How to apply:** An uninvited new Google user must get an independent empty book, never the reserved book that may contain legacy records. Keep existing staff invitations, suspensions, and the native Android and phone access rules intact.
