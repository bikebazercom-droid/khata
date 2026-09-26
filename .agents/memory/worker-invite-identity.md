---
name: Worker invitation identity
description: Why invitations for a verified worker identity are globally exclusive while pending
---

Allow only one pending worker invitation per normalized verified identity across all businesses, even though workers receive access only to assigned parties in one business.

**Why:** Claiming a pending invitation at first sign-in has no unambiguous business selector. Two concurrent pending invitations for the same email could otherwise attach a worker to an arbitrary owner's ledger.

**How to apply:** If multiple-business staff membership is later requested, design an explicit invitation acceptance step and business selection before relaxing this constraint; a business-scoped duplicate check alone is insufficient.

Deleting staff access means removing business access, not destroying the authentication identity or historic transaction attribution. Explicit reinvitation is allowed; it must require fresh authentication and must not revive previously revoked sessions.

**Why:** The owner chose removable access with later reinvitation, not a permanent ban. Physically deleting the user identity can trigger automatic owner provisioning on the next sign-in and break historical attribution.

**How to apply:** Preserve the identity/audit boundary whenever changing deletion or invite claims. Deleted staff must never regain access from old grants, ordinary activation, or stale sessions.