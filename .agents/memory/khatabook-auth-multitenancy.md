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
- `phone_session` JWT signed with SESSION_SECRET, 30-day expiry, httpOnly lax

## lib/db rebuild required after schema changes
- lib/db uses `composite: true` + `emitDeclarationOnly` — must run `cd lib/db && pnpm exec tsc --build` after any schema file change, or api-server tsc won't see new types

## Drizzle push workaround
- `drizzle-kit push` fails non-interactively when adding UNIQUE constraints to tables with existing data (requires TTY prompt)
- Workaround: apply schema changes directly via raw SQL (node script with pg.Pool), checking constraint existence before adding

**Why:** drizzle-kit has no --yes flag that skips the TTY requirement for constraint prompts.
**How to apply:** Any future schema change with UNIQUE constraints on tables with existing rows must go through a raw SQL migration script.
