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

- **Android:** The keyboard and safe-area wrapper changed to use the website's
  viewport logic directly; repeat device verification before calling this a
  pass.
- **iPhone:** Not tested. No iPhone is available in this preview environment;
  this result must not be treated as an iOS pass.

## Relevant implementation

- `../components/WebAppScreen.tsx` gives the website the full native WebView
  viewport and disables automatic native content insets.
- `../app.json` configures Android to resize for the software keyboard.
- `../../khatabook/src/pages/sign-in.tsx` and
  `../../khatabook/src/index.css` define
  the compact, scrollable sign-in layout.
- `../../khatabook/src/components/layout/main-layout.tsx` defines the website
  viewport shell used by ledger-entry screens.