---
name: Collapsible panel animation technique
description: max-height transition vs CSS Grid 0fr/1fr trick for animating a section open/closed
---

When a UI panel must animate smoothly between fully collapsed (zero height) and expanded
(natural height) — e.g. metadata fields that only appear once a user starts typing — prefer:

```
overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out
max-h-0 opacity-0   /* collapsed */
max-h-[Npx] opacity-100  /* expanded, pick N comfortably above real content height */
```

**Why:** The popular CSS Grid `grid-template-rows: 0fr -> 1fr` trick (wrapping content in a
`grid` container with a single-track child, animating `grid-rows-[0fr]` to `grid-rows-[1fr]`)
is the theoretically "correct" way to animate to auto-height, but proved unreliable in
practice in a nested flex/absolute-positioned mobile shell — the track did not collapse to
zero and left a large blank gap, even after adding `min-h-0` to the grid item. Root-caused
partly to interaction with an ancestor using `min-h-[100dvh]` instead of a fixed height (see
the mobile-fixed-height-layout note), but the max-height approach was simpler to reason about
and verify with an automated UI test, so it's the safer default choice.

**How to apply:** Default to the `max-height` transition technique for expand/collapse panels
unless you have verified the grid `fr` trick works end-to-end in the actual nested layout
(test it with a real browser check of computed/visible height, not just accessibility-tree
presence, since children can report nonzero intrinsic size even while a clipping ancestor
hides them).
