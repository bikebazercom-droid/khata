# cPanel local object storage

The existing GCS/Replit driver remains the default. For a cPanel deployment
using a persistent directory outside the web root, set:

```text
OBJECT_STORAGE_DRIVER=local
LOCAL_PRIVATE_OBJECT_DIR=/home/CPANEL_USER/private/banglakhata-objects
LOCAL_OBJECT_STORAGE_SECRET=<long random secret>
PUBLIC_API_URL=https://helmetbazar.shop
PUBLIC_HTML_DIR=/home/CPANEL_USER/public_html
CORS_ALLOWED_ORIGINS=https://helmetbazar.shop,https://www.helmetbazar.shop
```

`LOCAL_PRIVATE_OBJECT_DIR` must already be writable by the Node application
and must not be inside `PUBLIC_HTML_DIR` (or be a symlink). Both paths must be
absolute; the public web root must exist before the API starts. The optional
`LOCAL_PUBLIC_OBJECT_DIR` enables the existing unauthenticated
`/api/storage/public-objects/*` route for public assets; leave it unset unless
that route is needed.

Private uploads still use the unchanged
`POST /api/storage/uploads/request-url` response and `/objects/<path>` values.
The local PUT URL uses the `PUBLIC_API_URL` origin and returns a short-lived
Bearer capability bound to the authenticated business, object path, expected
size, and image content type. Configure `PUBLIC_API_URL` as the API origin
without a path, query, or trailing endpoint. Local PUTs are limited to 20 MiB
and JPEG, PNG, WebP, or GIF content.
In production, `CORS_ALLOWED_ORIGINS` is required for local-storage mode and
must list only the exact web origins that should call the API.
Private GETs remain authenticated and perform the existing ledger-row/business
ownership check before opening a file. Files are streamed only through
Express, never from the static web root.