---
name: Portable report filenames
description: Avoid filename mojibake when generated BanglaKhata reports are downloaded or shared on phones.
---

Generated statement and report PDFs use ASCII-only filenames, independent of Bengali party and business display names. Bengali remains in the PDF content and share-sheet title.

**Why:** Some Android share targets decode UTF-8 filename metadata using a legacy character encoding, producing mojibake even when the PDF contents render correctly.

**How to apply:** Use the shared filename builder for every PDF download, Web Share, and Expo WebView export path; do not interpolate Bengali user-visible names into filenames.
