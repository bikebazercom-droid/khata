# BanglaKhata cPanel package

This ZIP contains static website files and a separately run Node.js API. It is
not a `public_html`-only application: PHP/Apache static hosting cannot run the
API.

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

- `public_html/` — the BanglaKhata web app at `/` and the admin app at `/admin/`.
- `node-app/` — compiled API, production Node dependencies, and start script.
- `database/helmetba_bkdb-bootstrap.sql` — GUI-importable PostgreSQL schema
  for the `helmetba_bkdb` database (19 tables, foreign keys, and indexes).

The repository's existing app download files were invalid placeholder binaries,
so they are intentionally not included. Build and verify any APK or desktop
installer before publishing it.

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

## Data and service limitations

- This package does not copy existing Replit PostgreSQL records or GCS bill
  images. The bootstrap SQL creates tables only. Plan and verify a separate
  data-and-image migration before switching production users.
- Replit's Twilio connection is not portable in this ZIP. SMS/OTP and reminder
  sending need a cPanel-compatible Twilio setup before relying on those flows.
- The web bundle contains the Clerk **public** key used when it was built. If
  you change Clerk tenants, rebuild the web and mobile clients with the matching
  public key; never put a Clerk secret in a client build.
- Configure the native Android project's `EXPO_PUBLIC_API_URL` to this HTTPS
  origin if it differs. The separate Android Studio ZIP is source, not a
  tested APK.

The API typecheck, bundle build, and focused local-storage tests passed in the
Replit workspace. The cPanel account, database, SMS provider, Windows APK build,
and a physical Android device have not been tested; this is a deployment package,
not a claim of a verified production cutover.