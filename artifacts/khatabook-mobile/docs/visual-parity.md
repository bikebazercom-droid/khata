# Web and Expo Web visual parity checks

The screenshot runner uses Playwright with the Replit Chromium binary to compare
the website preview with Expo's browser preview at **390×844** and **412×915**.
It waits for the page content (including the Expo iframe) before capturing,
then saves both screenshots and a difference image for every route. A mismatch
line includes the route, viewport, pixel-difference percentage, and image
filename.

## Run

Keep the web and Expo workflows running, then pass their preview base URLs:

```sh
pnpm --filter @workspace/khatabook-mobile test:visual-parity -- \
  --web-url http://127.0.0.1:80 \
  --expo-url https://<active-expo-web-preview-host>/
```

The Replit runner must provide `chromium` and ImageMagick's `magick` command.
`playwright-core` is a development dependency; it does not download a browser.
Use `--output-dir <path>` to keep captures, `--capture-timeout-ms 60000` to
allow slower previews to load, or `--max-diff-percent 1.5` to adjust the
default pixel-difference threshold.

## Screens covered

- **Landing:** real public route in both previews.
- **Phone OTP sign-in:** real `/sign-in` route in both previews. The runner
  selects the phone-number tab and captures the phone-entry step without
  submitting a number or sending an OTP. This is currently a reported
  difference, not a passing parity assertion: the website and Expo use separate
  sign-in layouts. The runner labels this route `KNOWN DIFFERENCE` and includes
  each viewport in the output.
- **Party ledger and transaction report:** isolated visual fixtures with
  fictional names, masked phone details, and static amounts. These are served
  from source-only Vite pages and selected in Expo Web through an allowlisted
  development-only query parameter. They do not bypass authentication, make API
  calls, or use production/customer data. They compare wrapper and viewport
  parity, not backend behavior or the authenticated production pages.

The public landing page was previously visually compared at both target sizes.
The screenshot runner rechecks all four routes at both sizes and reports
unexpected differences on the landing and fixture routes as failures.