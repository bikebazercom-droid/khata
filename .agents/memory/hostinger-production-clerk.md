---
name: Hostinger production Clerk
description: User's deployment choice and account-identity constraints for production authentication on Hostinger.
---

The user chose to keep Hostinger and use their external production Clerk app. They confirmed its users were imported with the original Clerk user IDs.

**Why:** Hostinger's live Clerk environment reported development/test mode. Replit-managed Clerk's automatic production-key switch is for Replit publishing, not Hostinger.

**How to apply:** Keep Replit-managed development keys unchanged in Replit. Configure external live Clerk keys in Hostinger, bypass the Replit-managed Clerk proxy for the external provider, and preserve existing `app_users` identity links. Do not relink by email alone.
