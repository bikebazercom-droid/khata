---
name: Mobile single-page app shell must use fixed height
description: Why min-h-[100dvh] on the outer mobile shell breaks full-screen overlays and causes unwanted page scroll
---

In a mobile-first single-page app shell (phone-frame layout, `flex flex-col`), the outer
container must use `h-[100dvh]` (fixed height), not `min-h-[100dvh]`.

**Why:** With only `min-height` set, the flex column has no definite height for CSS flex
distribution purposes, so `flex-1` children don't reliably fill/clip to the viewport — the
container's actual height becomes content-driven and can grow taller than the viewport. Any
child using `absolute inset-0` (e.g. a full-screen overlay/modal rendered inside the shell)
inherits that oversized height from its positioned ancestor, producing real page-level
scroll (`window.scrollY > 0`) even when every individual screen is supposed to fit one
viewport with no scrolling.

**How to apply:** When building a single-column "native app" mobile shell where screens are
meant to fit exactly in one viewport (no body scroll, only internal `overflow-y-auto` panes
scroll), give the outermost shell container `h-[100dvh]` + `overflow-hidden`, not
`min-h-[100dvh]`. Verify with `window.scrollY` and `document.documentElement.scrollHeight`
after adding any new full-screen overlay.
