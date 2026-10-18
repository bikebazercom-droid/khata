---
name: Tailwind colors in html2canvas PDFs
description: html2canvas 1.4.1 fails on Tailwind v4 computed colors until they are converted to a supported color syntax.
---

html2canvas 1.4.1 does not parse `oklch()` CSS colors. Tailwind v4 emits `oklch()` values for utility colors, so a document can look correct in the browser but fail during PDF DOM parsing with `Attempting to parse an unsupported color function "oklch"`.

**Why:** The invoice PDF failure persisted even after fixing layout readiness; the browser console identified the unsupported color function before canvas rendering started.

**How to apply:** Before using html2canvas/html2pdf on a Tailwind-styled subtree, normalize its computed color declarations to `rgb()`/`rgba()` on the source or cloned subtree. Prefer inline styles for specialized PDF-only documents, as existing ledger report templates do. Keep a print fallback for renderer failures.
