# Keyboard layout verification

## Expected keyboard-open layout

The Expo app displays the website inside a native WebView. When the software
keyboard opens:

- **Phone OTP sign-in:** The WebView viewport adjusts. On short phone viewports,
  the branding header is hidden; the OTP field and its submit action remain
  visible or can be reached by scrolling.
- **Ledger entry:** The amount field remains visible above the keyboard, and
  the form can scroll to reach the remaining controls.

## Verification status

- **Android:** User-reported as tested and verified. The OTP field and ledger
  amount fields stayed visible above the keyboard with the expected layout
  adjustment.
- **iPhone:** Not tested. No iPhone is available in this preview environment;
  this result must not be treated as an iOS pass.

## Relevant implementation

- `../components/WebAppScreen.tsx` wraps the native WebView in keyboard
  avoidance.
- `../app.json` configures Android to resize for the software keyboard.
- `../../khatabook/src/pages/sign-in.tsx` and
  `../../khatabook/src/index.css` define
  the compact, scrollable sign-in layout.
- `../../khatabook/src/components/layout/main-layout.tsx` defines the website
  viewport shell used by ledger-entry screens.