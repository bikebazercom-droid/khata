---
name: Web PDF capture lifecycle
description: Capture multipage statement pages from iframe-rendered source markup with html2canvas.
---

Keep html2canvas render targets connected to the document that owns them until capture. When report markup is built in a hidden iframe and pages are rendered in the app document, import the nodes into the rendering document and copy computed styles while the source remains attached. Do not copy the source table's content-derived `height`/`block-size` to each paginated table, and remove page nodes only after capture.

For fixed-width PDF headers and footers, use explicit table columns rather than nested flex layouts. Keep long shop names on one line and size them to the available header cell; put phone, email, and terms in distinct footer rows.

**Why:** html2canvas must find its reference element in the cloned document, and computed stylesheet rules stop applying to iframe nodes after their source is detached. A copied table's block size describes all original rows, not the smaller subset on a paginated page, causing every page to overflow. Nested flex items can also wrap unpredictably in fixed-width report banners, so table cells provide clearer boundaries for text and prevent footer collisions. JSDOM also omits `requestAnimationFrame` and `document.fonts`, so the export path must not hang or throw when those optional browser APIs are absent.

**How to apply:** For iframe-backed html2canvas reports, preserve the source until pagination and any page rebalancing are complete, then remove it before capture. Use table cells for header/footer columns, separate contact lines from legal copy, and verify a multi-page PDF with repeated headers, page counters, and a final total row. Treat font preloading as optional and fall back to a timer when animation frames are unavailable in non-visual test environments.
