---
name: WebView connectivity checks
description: Avoid false offline screens when native WebViews misreport browser online state.
---

Treat `navigator.onLine` and browser `online`/`offline` events as hints in native WebViews, not as proof that the backend is unreachable. Confirm connectivity with a real authenticated same-origin HTTPS API request; retry that probe on visibility changes and connectivity events.

**Why:** Android WebView can report offline while the app's HTTPS connection still works, which otherwise blocks sign-in, writes, or queued synchronization.

**How to apply:** For WebView-backed apps, gate the offline state on failed API probes and avoid using the browser flag alone to suppress requests or outbox replay.
