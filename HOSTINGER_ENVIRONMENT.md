# Hostinger environment configuration

This project uses one Node.js API server to serve the BanglaKhata web app and
admin app. Hostinger's environment is separate from Replit's; a secret visible
in Replit does not mean the same variable exists on Hostinger.

## Build and Node application settings

- Node.js: 22 or newer (24 is used in the workspace).
- Build command: `pnpm run build:hostinger`
- Required build-time variable: `HOSTINGER_EXTERNAL_CLERK_PUBLISHABLE_KEY`.
  Set it to the publishable key for the external Clerk instance used by this
  deployment. It is public configuration, not a secret. The build script maps
  it to the web app's `VITE_CLERK_PUBLISHABLE_KEY`.
- Entry File: `artifacts/api-server/dist/index.mjs`
- Runtime start command, if Hostinger asks for one:
  `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- Do not set the Entry File to `pnpm start`.

## Health checks

- `GET /api/healthz` confirms the API process is responding; it does not query PostgreSQL.
- `GET /api/readyz` runs a lightweight database query. It returns HTTP 200 with
  `{"status":"ready"}` when PostgreSQL is reachable, or HTTP 503 with
  `{"status":"not_ready"}` otherwise. Use this route to check database readiness;
  it does not expose connection or database details.

## Required runtime variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Hostinger-provided listening port. The server exits with a clear error if it is absent or invalid. |
| `NODE_ENV=production` | Enables production security behavior. |
| `SERVE_FRONTENDS=true` | Serves the built web and admin apps from the API server. |
| `DATABASE_URL` | PostgreSQL connection string. Use a persistent/session-capable connection; Supabase transaction-pooler connections do not support this server's persistent `LISTEN`/`NOTIFY` event bus. |
| `SESSION_SECRET` | Long, random server secret used for phone sessions, OTP hashing, and persistent rate limits. |
| `ADMIN_USERNAME` | Admin-panel login name. |
| `ADMIN_PASSWORD` | Strong, unique admin-panel password. |
| `ADMIN_SECRET` | Long, random secret used to sign admin sessions; keep distinct from `SESSION_SECRET`. |

For Clerk sign-in, also set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` at
runtime to keys from the same external Clerk instance as the build-time
`HOSTINGER_EXTERNAL_CLERK_PUBLISHABLE_KEY`. Keep the secret key in Hostinger's
secret-variable settings.

## SMS OTP configuration

- `SMS_NET_BD_API_KEY` is required to deliver phone OTPs. Store it as a
  **backend runtime secret** in Hostinger. Do not put it in a `VITE_*` variable,
  browser code, a URL, or the admin form.
- `SMS_NET_BD_API_URL` is optional. If omitted, the server uses
  `https://api.sms.net.bd/sendsms`. Overrides are accepted only for that exact
  HTTPS host and path, so the API key cannot be sent to an arbitrary endpoint.
- If the API key is missing, the API still starts. Startup logs a warning, the
  admin OTP settings page reports the missing configuration, and send requests
  return a generic 503. Logs identify the failure stage and safe provider/HTTP
  error codes; they do not include OTPs, phone numbers, API keys, or response
  bodies.
- Saving the OTP setting does not send a test SMS. Confirm delivery only with an
  authorized test number and an intentional sign-in request.

## Existing database schema for OTP rate limits

The phone OTP routes use a PostgreSQL-backed rate limiter before validating the
request body or contacting sms.net.bd. The database must contain
`public.otp_rate_limit_counters`. If the live OTP endpoint returns HTTP 500 even
for an empty/invalid phone request, this table or its database connection may be
missing; that failure happens before the SMS gateway is called.

For an existing Hostinger database, run the additive, repeatable SQL in either
`exports/BanglaKhata-cPanel/database/otp-rate-limit-counters-migration.sql` or
`exports/BanglaKhata-Core-Backend/database/otp-rate-limit-counters-migration.sql`
against the same database used by `DATABASE_URL`.
Both Hostinger bootstrap SQL files include this table for new installs.
For an existing database, run only the focused migration above; do not rerun a
full bootstrap over live ledger data. The table is available as soon as the SQL
transaction commits, so an app restart is not normally required.

Verify the table and cleanup index in that same database with:

```sql
SELECT to_regclass('public.otp_rate_limit_counters') AS rate_limit_table;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'otp_rate_limit_counters';
```

## File storage for Hostinger

For bill-photo/file uploads on Hostinger, use the local storage driver and
persistent paths outside the public web root:

```text
OBJECT_STORAGE_DRIVER=local
LOCAL_PRIVATE_OBJECT_DIR=/home/ACCOUNT/private/banglakhata-objects
LOCAL_OBJECT_STORAGE_SECRET=<set a separate long random secret>
PUBLIC_API_URL=https://your-api-domain.example
PUBLIC_HTML_DIR=/home/ACCOUNT/public_html
CORS_ALLOWED_ORIGINS=https://your-web-domain.example,https://your-admin-domain.example
```

Use absolute paths. The private object directory must be writable by the Node
process and must not be inside (or symlinked into) `PUBLIC_HTML_DIR`. The public
web root must already exist. In production, `CORS_ALLOWED_ORIGINS` is required
for local storage and must list only exact browser origins. Set
`LOCAL_PUBLIC_OBJECT_DIR` only if the public-objects route is needed.

The Replit object-storage variables `PRIVATE_OBJECT_DIR`,
`PUBLIC_OBJECT_SEARCH_PATHS`, and `DEFAULT_OBJECT_STORAGE_BUCKET_ID` are not a
replacement for configuring persistent storage on Hostinger.

## Optional operational settings

- Configure exactly one of `TRUSTED_PROXY_CIDRS` (the actual ingress proxy
  CIDRs) or `CLIENT_IP_MODE=direct` for verified client IP handling and IP
  rate limits. Do not trust arbitrary forwarded headers.
- `LOG_LEVEL` defaults to `info`.
- `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` are
  only needed if the optional AI integration is enabled.

Keep all secrets in Hostinger's server-side environment settings. After
changing runtime variables, restart the Node application. After changing the
Clerk publishable key, rebuild the frontend as well.