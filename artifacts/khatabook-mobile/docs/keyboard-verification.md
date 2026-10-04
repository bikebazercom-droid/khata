# Keyboard layout verification

## Expected keyboard-open layout

The Expo app displays the website inside a full-screen native WebView. The
website owns its safe-area and keyboard-responsive layout; the native shell
does not add a second safe-area inset or keyboard offset. When the software
keyboard opens:

- **Phone OTP sign-in:** The WebView viewport adjusts. On short phone viewports,
  the branding header is hidden; the OTP field and its submit action remain
  visible or can be reached by scrolling.
- **Ledger entry:** The amount field remains visible above the keyboard, and
  the form can scroll to reach the remaining controls.

## Verification status

- **Browser and Expo Web preview:** The public landing page was compared at
  390×844 and 412×915; the layouts match after both previews finish loading.
  This checks the shared website viewport, not native safe-area or keyboard
  behavior.
- **Native iOS and Android:** Not verified. This runner has no `adb` or Android
  emulator, and no `xcrun` or Xcode simulator. Successful iOS/Android bundle
  exports confirm compilation only, not device rendering.
- **OTP, ledger-entry keyboard, and authenticated transaction report:** Not
  visually verified. The preview capture cannot sign in or interact with the
  app, and no native simulator is available here.

## Relevant implementation

- `../components/WebAppScreen.tsx` gives the website the full native WebView
  viewport and disables automatic native content insets.
- `../app.json` configures Android to resize for the software keyboard.
- `../../khatabook/src/pages/sign-in.tsx` and
  `../../khatabook/src/index.css` define
  the compact, scrollable sign-in layout.
- `../../khatabook/src/components/layout/main-layout.tsx` defines the website
  viewport shell used by ledger-entry screens.