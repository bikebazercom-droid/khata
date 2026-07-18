# Manual QA Checklist — Bill Photo Thumbnails in PDF

Use this checklist whenever automated tests cannot substitute for a real
browser rendering check (e.g. after changes to `ledger-report.tsx`,
`billImageStorage.ts`, `party-view.tsx`, or any html2pdf/html2canvas upgrade).

Run in a Chromium-based browser where the Banglakhata web app is served.

---

## Prerequisites

1. Sign in to the app and open (or create) a party that has **at least two
   ledger entries**, where **at least one entry has a bill photo attached**.
2. Open DevTools → Network tab, filter by "storage" to confirm cloud images
   are served from `/api/storage/objects/…`.

---

## Path A — Report Download (`handleReport`)

| # | Step | Expected |
|---|------|----------|
| A1 | Tap **রিপোর্ট** (FileDown icon) on the party view action bar. | Spinner appears; button is disabled during generation. |
| A2 | Wait for the browser's download to trigger. | A `.pdf` file is saved (filename: `<PartyName>_Banglakhata_Ledger.pdf`). |
| A3 | Open the downloaded PDF. | Each ledger row that had a bill photo shows a **48×48 px thumbnail** in the Details column. |
| A4 | Rows without a bill photo show **no thumbnail** cell — just the description text. | ✓ |
| A5 | The thumbnail is not blank, white, or a grey "?" placeholder. | ✓ (placeholder only appears when the image failed to fetch) |
| A6 | Repeat with the device in **airplane mode** (or Network throttling set to "Offline" in DevTools). Tap রিপোর্ট again. | A warning toast appears for any images that couldn't load; the PDF still downloads and thumbnails that were cached appear correctly. |

---

## Path B — Reminder Share (`handleReminderShare`)

| # | Step | Expected |
|---|------|----------|
| B1 | Tap **রিমাইন্ডার** (MessageCircle icon) on the party view action bar. | Spinner appears; button is disabled during generation. |
| B2 | The native share sheet opens (or on desktop the PDF downloads and WhatsApp opens). | ✓ |
| B3 | Accept / save the PDF from the share sheet. | A `.pdf` file is produced (same filename format as Path A). |
| B4 | Open the PDF. | Same thumbnail rendering requirements as A3–A5 above. |
| B5 | Cancel the share sheet mid-flow. | No error toast; the reminder button returns to normal without crashing. |

---

## Regression signals (fail the checklist if any of these occur)

- Thumbnail cell is **blank white** — `prefetchImagesForPdf` did not replace the
  `src` before html2canvas ran, or the img element was not rendered by
  `LedgerReportDocument`.
- Thumbnail cell shows a **grey "?" SVG** when the image exists — fetch failed
  (auth cookies not sent, CORS, or network error).
- Thumbnail cell is **missing entirely** — `billImageSrc()` returned `null` for
  a non-null `billImage`, or the conditional render in `ledger-report.tsx`
  evaluates falsily.
- Downloading triggers a JS error in DevTools console — likely a runtime
  exception inside `prefetchImagesForPdf` or `buildReportPdf`.
