---
name: First-book name onboarding
description: The new-owner first-book naming marker and synchronization rules.
---

New owner onboarding uses an empty name on the owner’s existing or first business and its settings row as the “needs a name” state. Keep owner provisioning, `/api/auth/me`, and the authenticated rename endpoint synchronized; staff must skip this prompt. A successful rename updates both `businesses.name` and `business_settings.store_name`.

**Why:** This preserves the existing primary/seed-business identity and avoids a schema migration; a visible default name cannot distinguish a new account from an existing owner.

**How to apply:** When changing signup or book creation, preserve the empty-name marker until the owner submits a nonblank name. Do not create a second business just for setup.
