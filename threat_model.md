# Threat Model

## Project Overview

BanglaKhata (বাংলা খাতা) is a mobile-first Bengali-language billing and ledger web app for Bangladeshi shop owners. It tracks money owed by customers and suppliers. The stack is React/Vite frontend, Express 5 API server, PostgreSQL + Drizzle ORM, deployed publicly on Replit Autoscale (`https://hazarikhata.replit.app`).

Authentication supports two paths:
- **Clerk** — web users authenticate via Clerk (Google/email).
- **Phone OTP** — mobile users authenticate via a 6-digit OTP sent via SMS (currently only logged to console; Twilio not yet wired).

An admin dashboard (`/admin`) is separately authenticated by username/password → admin JWT.

## Assets

- **Business ledger data** — parties, ledger entries, balances. PII for shop customers (names, phone numbers), financial transaction records.
- **Bill images** — photos of physical receipts stored via object storage. Business-sensitive documents.
- **OTP codes** — short-lived 6-digit codes used as the sole authentication factor for phone users.
- **Session JWTs** — `phone_session` cookie and Bearer tokens granting API access scoped to a business.
- **Admin credentials** — username/password plus a JWT signing secret protecting the admin panel which can read/write all users and business data.
- **Application secrets** — `SESSION_SECRET` (phone JWT signing key), `ADMIN_SECRET` (admin JWT signing key), `DATABASE_URL`.

## Trust Boundaries

- **Internet → API** — all inbound HTTP. Public routes: `GET /health`, `POST /admin/auth/login`, `POST /auth/phone/send-otp`, `POST /auth/phone/verify-otp`. Everything else requires Clerk or phone-session auth.
- **Authenticated user → business data** — `requireAuth` middleware enforces session validity then scopes all DB queries to `businessId` derived from the session. Prevents cross-business access.
- **Authenticated user → object storage** — presigned URL upload is auth-gated. Object download at `/storage/objects/*` is auth-gated but object-level ACL check is currently disabled (see vulnerability).
- **Admin JWT → admin panel** — admin endpoints are protected by a separate JWT signed with `ADMIN_SECRET`. Admin can read all users/businesses and modify user status.
- **Mobile app ↔ API** — same API, Bearer token in header instead of cookie. Token lifetime is 30 days.

## Scan Anchors

- **Public entry points**: `POST /auth/phone/send-otp`, `POST /auth/phone/verify-otp`, `POST /admin/auth/login`
- **Highest-risk code**: `artifacts/api-server/src/routes/auth.ts` (OTP issuance), `artifacts/api-server/src/middlewares/requireAdmin.ts` (admin JWT secret), `artifacts/api-server/src/routes/admin.ts` (admin credentials), `artifacts/api-server/src/routes/storage.ts` (object ACL)
- **Protected surfaces**: all `/api/*` except health and auth bootstrap routes
- **Dev-only**: `artifacts/mockup-sandbox/` — design canvas, not production-reachable API

## Threat Categories

### Spoofing

Phone OTP is the sole auth factor for mobile users. A 6-digit code (1 000 000 possibilities) is valid for 10 minutes. **No rate limiting exists** on the verify endpoint, making brute-force feasible. OTPs are currently only logged to the server console rather than sent by SMS, meaning anyone with log access can authenticate as any phone user.

Admin authentication relies on a username/password pair defaulting to `admin`/`banglakhata-admin-2024` if `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars are absent. The admin JWT is signed with a secret defaulting to `"changeme-dev-secret"` if `ADMIN_SECRET` is unset, allowing forged admin tokens.

**Required guarantees**: `ADMIN_PASSWORD`, `ADMIN_SECRET`, and `SESSION_SECRET` MUST be set to strong random secrets in production. OTP endpoints MUST enforce rate limiting (e.g. 5 attempts per phone per 10 min). OTPs MUST NOT appear in production logs.

### Information Disclosure

OTPs are logged at INFO level to stdout: `console.log('[OTP] ${phone} → ${code}')`. In any log aggregation pipeline (Replit console, external log drain) this exposes authentication codes to anyone with log access.

Admin user listing at `GET /admin/users` returns phone numbers and device metadata for all users.

**Required guarantees**: OTP values MUST NOT be logged in production. Error responses MUST NOT leak stack traces or internal details (currently handled well — only generic messages returned).

### Elevation of Privilege

The `/storage/objects/*path` route is behind `requireAuth` but the per-object ACL check (verifying the requesting user owns or has read permission on the object) is commented out. Any authenticated user who can guess or enumerate an object path can download another user's bill images.

SQL injection risk is low — all queries use Drizzle ORM parameterized statements. No raw `sql` interpolation of user input detected.

**Required guarantees**: Object-level ACL MUST be enforced on the `/storage/objects/*` route. Bill images MUST only be downloadable by the business that uploaded them.

### Denial of Service

No rate limiting on `POST /auth/phone/send-otp` allows an attacker to trigger unlimited OTP messages to arbitrary phone numbers (SMS flooding / abuse of the SMS gateway budget) and exhaust the OTP gateway balance.

**Required guarantees**: OTP send endpoint MUST be rate-limited per phone number (e.g. 3 per hour) and per IP. OTP verify endpoint MUST lock out after a small number of failures.
