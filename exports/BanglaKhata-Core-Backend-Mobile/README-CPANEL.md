# BanglaKhata cPanel Core Backend & Mobile Source

This package is the Node.js API, database bootstrap, and Android Studio source
for the mobile client. The public website and `/admin` static files are in a
separate `public_html` package. This is not a `public_html`-only application:
PHP/Apache static hosting cannot run the API.

## Before deployment

Confirm that the hosting account provides a Node.js Application Manager or
Passenger, supports Node.js 20 or newer, and can route `https://helmetbazar.shop/api/*`
to the Node application **without removing the `/api` prefix**. This has not
been tested on the target cPanel account. If any of these are unavailable, the
API needs a separate Node host and the web/mobile API origins must be changed.

Also prepare:

- A PostgreSQL database and connection string reachable from the Node app.
- An HTTPS certificate for the chosen domain.
- A writable private directory outside `public_html` for bill images.
- Your own production environment values, entered through cPanel's Node app
  environment settings. No credentials or database data are included here.

## Package contents

- `node-app/` — compiled API, production Node dependencies, and start script.
- `database/helmetba_bkdb-bootstrap.sql` — GUI-importable PostgreSQL schema
  for the `helmetba_bkdb` database (19 tables, foreign keys, and indexes).
- `mobile-app/` — Android Studio source; it is not a signed production APK.

No APK or Windows installer is included. The existing APK is a debug build, not
a production release. Build and sign the Android release and prepare a Windows
installer separately, then upload them through `/admin` after the API is live.

## Create the PostgreSQL tables from a GUI

1. In cPanel's PostgreSQL Databases page, confirm `helmetba_bkdb` exists and
   that the database user assigned to the API has create/use privileges on the
   `public` schema.
2. Back up the database first if it contains anything you need to keep.
3. Open the hosting provider's PostgreSQL SQL/Import screen (or phpPgAdmin),
   select `helmetba_bkdb`, and import
   `database/helmetba_bkdb-bootstrap.sql`. The script checks the selected
   database name before creating anything.
4. Confirm the tables appear in the database browser. The script creates
   missing tables, foreign keys, and indexes inside one transaction; it does
   not insert application records, drop objects, or alter existing columns.

The script is safe to rerun when matching tables and constraints already
exist. It is not a repair migration for tables whose columns differ from this
version. If your database already has a different or partial BanglaKhata
schema, stop and take a schema backup before proceeding. If cPanel prefixes the
database name and `current_database()` is not exactly `helmetba_bkdb`, change
the guard at the top of the SQL file to the actual database name before
importing.

## Deploy

1. Back up the current site and database. Extract `public_html/` into the
   domain's document root. Keep the included `.htaccess`; it provides SPA
   fallback routes but does not configure Passenger.
2. Place `node-app/` outside the document root, for example
   `/home/CPANEL_USER/banglakhata-node`. In cPanel's Node.js Application Manager,
   select Node 20+, set that application root, and use `npm start`.
3. Create or select the PostgreSQL database. For `helmetba_bkdb`, follow the
   GUI import steps above before starting the API.
4. Configure these environment values in the Node app settings:

   - `NODE_ENV=production`
   - `DATABASE_URL` — cPanel PostgreSQL URL
   - `SESSION_SECRET` — a new, long random secret
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SECRET` — new admin values
   - `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — production Clerk values;
     authorize the deployed proxy origin in Clerk
   - `AI_INTEGRATIONS_OPENAI_API_KEY` and
     `AI_INTEGRATIONS_OPENAI_BASE_URL` — your own provider credentials and
     endpoint; Replit AI integration credentials are not exported
   - `OBJECT_STORAGE_DRIVER=local`
   - `LOCAL_PRIVATE_OBJECT_DIR=/home/CPANEL_USER/banglakhata-private`
   - `LOCAL_OBJECT_STORAGE_SECRET` — a separate long random secret
   - `PUBLIC_HTML_DIR=/home/CPANEL_USER/public_html` — replace with the actual
     document-root path
   - `PUBLIC_API_URL=https://helmetbazar.shop`
   - `CORS_ALLOWED_ORIGINS=https://helmetbazar.shop,https://www.helmetbazar.shop`
    - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` for
      cPanel phone OTP and SMS reminders. Use the E.164 number registered to the
      Twilio account. Keep the auth token only in the server environment.
   - `TRUSTED_PROXY_CIDRS` if required by the host; obtain the correct proxy
     addresses from the hosting provider
   - `PORT` is normally supplied by cPanel; do not hard-code it

   Ensure the Node app user can write to the private storage directory. Never
   place that directory under `public_html`.
5. Configure cPanel/Passenger to forward `/api/*` to the Node app while
   preserving the `/api` path prefix. The included `.htaccess` deliberately
   avoids rewriting `/api` to the website; it does not create this proxy.
6. Start/restart the app and test the API, sign-in, a ledger entry, and a
   private bill image upload before changing users over.

### If the website says it is offline

The web files can load while the API is stopped or unreachable. Without a
signed-in session, `GET /api/auth/me` should return a `401` JSON response; it
must not return a `503` HTML page. A `503` usually means the Passenger app did
not start, its startup environment is incomplete, or `/api` is not mapped to
the Node app. Check cPanel's Node application and Apache/Passenger error logs.
The database SQL creates tables, but it does not configure or start Passenger.

## Authentication, SMS, data, and release requirements

- This package does not copy existing Replit PostgreSQL records or GCS bill
  images. The bootstrap SQL creates tables only. Plan and verify a separate
  data-and-image migration before switching production users.
- The API uses Twilio's authenticated REST API on cPanel when all three
  `TWILIO_*` settings are configured. The Replit connector remains available
  only when the app is actually running in Replit. SMS delivery has not been
  tested against the target Twilio account.
- Google sign-in is provided by Clerk. Set production Clerk keys in cPanel and
  in the mobile build, and configure the production Google provider and allowed
  proxy/origin in Clerk. Development Clerk users do not carry over to production.
- The web bundle contains the Clerk **public** key used when it was built. If
  you change Clerk tenants, rebuild the web and mobile clients with the matching
  public key; never put a Clerk secret in a client build.
- The Android source is configured for `https://helmetbazar.shop`. If the
  production host differs, update `mobile-app/mobile/public-build.json` to the
  HTTPS origin (without a trailing `/api`) before making a release build.
- To build the Android release from the included source, install the required
  Node.js/Android SDK toolchain, then run `corepack pnpm install --frozen-lockfile`,
  `corepack pnpm typecheck`, and `corepack pnpm android:release` from
  `mobile-app/`. The APK is written to
  `mobile-app/mobile/android/app/build/outputs/apk/release/app-release.apk`.
  No signing key is included; create and protect your own production signing
  key before distributing updates.
- `/admin` can upload the APK and Windows installer after deployment. Until
  valid release files are uploaded, their public download buttons must remain
  unavailable.

The API typecheck, bundle build, and automated tests run in the Replit
workspace. The cPanel account, database, SMS provider, signed Android release,
Windows installer, and physical Android device have not been tested. This is a
deployment package, not a claim of a verified production cutover.