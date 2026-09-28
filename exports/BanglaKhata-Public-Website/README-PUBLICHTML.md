# BanglaKhata Public Website + Admin

This package contains the static landing site at `/` and the admin app at
`/admin/`. It does not include or run the Node.js API. Use it together with the
separate **BanglaKhata Core Backend & Mobile Source** package.

## Install on cPanel

1. Back up the current site.
2. Extract the contents of `public_html/` into the domain's document root.
   Preserve `.htaccess`; it provides the client-side routes.
3. Configure cPanel/Passenger to send `/api/*` requests to the Node app from the
   core package, preserving the `/api` prefix. Static Apache/PHP hosting cannot
   run the API.
4. Enable HTTPS and test `/`, `/admin/`, API sign-in, and the admin dashboard.
5. After the API is running, sign in to `/admin/` and upload the verified
   production Android APK and Windows installer. This package intentionally
   contains no placeholder or debug binaries.

The static files are built for the existing `helmetbazar.shop` Clerk public
key. If the production Clerk tenant or host changes, rebuild the web and mobile
clients with matching production settings before launch. The target cPanel
account has not been tested by this package build.