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
- **Native iOS and Android:** The user reports that both simulator previews
  passed the safe-area/cutout and keyboard-open checks. No screenshots or
  recordings were attached, and this runner has no `adb` or Android emulator,
  nor `xcrun` or Xcode simulator, so I could not independently inspect those
  native renders. Bundle exports confirm compilation only.
- **OTP, ledger, and transaction report:** The user confirms these flows were
  checked and passed in both platform previews. The browser capture itself
  cannot sign in or interact with these screens.

## Automated regression guard

`../lib/mobileViewportContract.test.ts` checks that the active website shell
does not add a second safe-area or keyboard offset, iOS WebView inset
adjustments stay disabled, Android continues to resize for the keyboard, and
the website CSS retains its safe-area and compact sign-in rules. These
configuration checks do not replace opening the keyboard in a native simulator.

## Manual native simulator checklist

Repeat these steps separately in the iOS and Android simulator previews:

1. Open OTP sign-in and focus the phone/OTP input with the software keyboard
   open. Check that the field and submit action remain reachable.
2. Open a party ledger, start an entry, and focus the amount field. Check that
   the field and save action remain reachable while the keyboard is open.
3. Check the top and bottom of each screen against the status bar, cutout, and
   home/navigation area.
4. Open the transaction report and confirm its layout fits the phone viewport.
5. Record each platform result and any device/OS details.

## User-reported simulator results (2026-10-04)

- **iOS preview:** Pass — safe areas/cutouts, keyboard-open, OTP, ledger, and
  transaction report were confirmed by the user. No screenshot or recording
  was attached.
- **Android preview:** Pass — the same checks were confirmed by the user. No
  screenshot or recording was attached.

## Relevant implementation

- `../components/WebAppScreen.tsx` gives the website the full native WebView
  viewport and disables automatic native content insets.
- `../app.json` configures Android to resize for the software keyboard.
- `../../khatabook/src/pages/sign-in.tsx` and
  `../../khatabook/src/index.css` define
  the compact, scrollable sign-in layout.
- `../../khatabook/src/components/layout/main-layout.tsx` defines the website
  viewport shell used by ledger-entry screens.