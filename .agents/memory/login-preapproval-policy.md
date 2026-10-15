---
name: Pre-approved login policy
description: Security boundary for admin-managed phone/email pre-approval.
---

Admins may pre-approve phone numbers and email addresses for new owner-account creation. A pre-approval is not proof of identity and must never bypass phone OTP or verified OAuth/email authentication. Admin-requested phone recovery sends a normal expiring OTP only to the saved phone; it never exposes a static bypass code. Soft deactivation blocks sign-in but preserves business and ledger history. Existing users continue signing in normally, and valid owner-issued staff invitations remain a separate enrollment path.

**Why:** The user chose pre-approval for new accounts with normal identity verification after being told that contact-only bypass could enable account takeover, and chose SMS OTP resend plus data-preserving deactivation for admin support.

**How to apply:** Enforce the allowlist only on new owner provisioning. Preserve OTP/OAuth verification, existing-account sign-in, and invitation-based staff access. Keep admin recovery phone-verified and account deactivation non-destructive.
