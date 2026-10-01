---
name: Legacy download-channel compatibility
description: Retire a distribution channel without changing stored values or static-host authentication.
---

Keep legacy distribution columns and their stored values when removal of the channel does not explicitly include data deletion. Remove inactive channels from active UI, API inputs/outputs, and routes with explicit allowlists; updates to the remaining desktop settings must not overwrite legacy values.

**Why:** A retired channel can still have historical configuration that users expect to preserve. Deleting or rewriting that data is a separate destructive decision.

**How to apply:** Check every API response and update path, not only the visible UI. Preserve the database columns unless a separate migration is approved.

Static deployment exports can embed a Clerk publishable key and a path base. Before replacing an export, compare the existing and rebuilt public-key identity without logging the key, and build for the same base path. For same-origin cPanel hosting, leave the Clerk proxy URL unset unless the existing deployment requires it.

**Why:** Rebuilding with a different Clerk tenant or path can break sign-in even when the new UI looks correct.

**How to apply:** Inspect the export build command and existing deployment README before copying generated assets. Verify old and new key identity without exposing the value.