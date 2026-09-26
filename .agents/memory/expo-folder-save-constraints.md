---
name: Expo Android folder export constraints
description: Why Android PDF folder export uses bounded SAF writes rather than a filesystem copy.
---

Keep the memory bound on Android folder exports until a real streaming content-URI writer replaces the whole-file transfer.

**Why:** Inspection of the installed Expo native filesystem implementation showed that filesystem copy destinations are not a safe substitute for SAF document destinations. The available SAF write path transfers the whole PDF as base64, increasing memory use on low-end phones.

**How to apply:** Do not remove the export size guard or replace the writer with a generic file copy without checking native destination support and memory behavior. Keep ordinary sharing available as an alternative.

The Android folder picker cannot promise selection of the Downloads root on Android 11+. Offer a permitted subfolder instead, and treat provider cleanup as fallible.

**Why:** Android restricts document-tree grants for certain roots, and a native deletion call can resolve even when the provider did not delete the partial document.

**How to apply:** Explain folder restrictions in the UI; verify cleanup where possible and warn if a partial file may remain. Native provider behavior needs device evidence, not mocked unit tests alone.