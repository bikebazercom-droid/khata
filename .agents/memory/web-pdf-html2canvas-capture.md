---
name: Web PDF capture lifecycle
description: Capture multipage statement pages from iframe-rendered source markup with html2canvas.
---

Keep html2canvas render targets connected to the document that owns them until capture. When report markup is built in a hidden iframe and pages are rendered in the app document, import the nodes into the rendering document and copy computed styles while the source remains attached. Do not copy the source table's content-derived `height`/`block-size` to each paginated table, and remove page nodes only after capture.

**Why:** html2canvas must find its reference element in the cloned document, and computed stylesheet rules stop applying to iframe nodes after their source is detached. A copied table's block size describes all original rows, not the smaller subset on a paginated page, causing every page to overflow.

**How to apply:** For iframe-backed html2canvas reports, preserve the source until pagination and any page rebalancing are complete, then remove it before capture. Verify with a multi-page PDF that includes repeated headers, page counters, and a final total row.
