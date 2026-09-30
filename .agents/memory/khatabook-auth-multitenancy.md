---
name: Khatabook auth & multi-tenancy
description: Architecture and gotchas for the khatabook multi-user cloud accounts feature
---

# Khatabook multi-tenancy auth setup

## DB schema facts
- New tables: `businesses`, `app_users`, `otp_codes`
- `parties.business_id` and `business_settings.business_id` added as nullable FKs
- Seed business UUID: `00000000-0000-0000-0000-000000000001` (hard-coded in requireAuth.ts)
- First Clerk/phone user to log in claims the seed business (all legacy data); subsequent users get fresh businesses

## Auth middleware
- `requireAuth` in `artifacts/api-server/src/middlewares/requireAuth.ts`
- Checks Clerk session first (`getAuth(req).userId`), then `phone_session` httpOnly JWT cookie
- Sets `req.userId` and `req.businessId` on success; 401 otherwise
- JIT user provisioning: first Clerk login creates or claims business

## Phone OTP
- Routes: POST /api/auth/phone/send-otp, POST /api/auth/phone/verify-otp, POST /api/auth/phone/logout, GET /api/auth/me
- Currently logs OTP to console — Twilio connector still needs connecting and wiring in auth.ts
- `phone_session` JWT is signed with SESSION_SECRET and stored in an httpOnly, lax browser cookie

## Phone sessions persist until explicit logout

Phone-session JWT expiry is not the revocation boundary. The server validates the account status and `phoneSessionVersion`; explicit logout increments that version. Continue accepting older signed phone JWTs that still carry an `exp`, and strip their legacy expiry when renewing the browser cookie. Browser cookies use a rolling 400-day lifetime.

**Why:** Users should remain signed in across restarts until they choose Log Out. Existing mobile tokens with a 30-day expiry must not silently expire after an app update, while server-side version checks still allow explicit revocation.
**How to apply:** Keep expiry bypass limited to phone-session verification and phone logout verification; preserve active-user/version checks, and refresh the browser cookie on authenticated requests. Clerk session lifetime remains controlled by its provider.

## lib/db rebuild required after schema changes
- lib/db uses `composite: true` + `emitDeclarationOnly` — must run `cd lib/db && pnpm exec tsc --build` after any schema file change, or api-server tsc won't see new types

## Drizzle push workaround
- `drizzle-kit push` fails non-interactively when adding UNIQUE constraints to tables with existing data (requires TTY prompt)
- Workaround: apply schema changes directly via raw SQL (node script with pg.Pool), checking constraint existence before adding

**Why:** drizzle-kit has no --yes flag that skips the TTY requirement for constraint prompts.
**How to apply:** Any future schema change with UNIQUE constraints on tables with existing rows must go through a raw SQL migration script.

## Truthful sign-in and sign-out reporting

Count a Clerk sign-in once when a verified session is first observed, not on every authenticated request. Only show a sign-out timestamp after the client explicitly reports the user's sign-out action; never derive it from session expiry or inactivity. Do not label this as live online presence.

**Why:** Frequent API requests otherwise make a last-login timestamp look current when no new sign-in occurred, and an expired session is not evidence of intentional sign-out.
**How to apply:** Keep session-level idempotency for sign-in observations, and distinguish explicit sign-out events from automatic expiration anywhere owner access activity is displayed.

## Sign-out must invalidate the server session

Do not treat removing a mobile credential or calling a client SDK's sign-out as sufficient proof that a previously copied bearer token is unusable. Revoke phone-session versions or Clerk session IDs server-side, and preserve the local credential when revocation fails so users can retry.

**Why:** Clearing storage affects only one device; old tokens can otherwise keep accessing a ledger until expiry, even though the UI says the user signed out.
**How to apply:** Test an old bearer token against a protected API route after sign-out. Let retries complete if server revocation succeeded but client SDK sign-out failed.

## Account deletion must be the final authenticated API action

After deleting an account, do not send any further authenticated app API requests while its Clerk session is still valid. Sign out with the client SDK directly.

**Why:** Auth middleware provisions a replacement identity when it sees a valid Clerk session without an app user.
**How to apply:** When changing deletion or logout flows, keep logout reporting before deletion only, and assert deletion leaves no user or business behind.

## Replit-managed to external Clerk migration

Before switching a deployment to another Clerk tenant, complete Replit's required managed-user migration step and obtain a verified old-to-new identity mapping. Do not relink ledger owners by email alone.

**Why:** Ledger ownership is attached to the local app user linked to a Clerk user ID; matching email does not prove that a new tenant identity should inherit existing business data. Replit's managed-Clerk migration requires a manual support step.
**How to apply:** Keep production keys unchanged until the identity migration plan is confirmed. If IDs change, use an explicit, reviewed mapping for owner and staff accounts, and preserve the existing business/user rows.
