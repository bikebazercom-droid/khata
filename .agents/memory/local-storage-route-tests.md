---
name: Local storage route tests
description: Setup ordering and directory constraints for API integration tests using the local object-storage driver.
---

API storage route tests that exercise local uploads must configure the local storage environment before dynamically importing the route module, because the storage backend is selected at module import time. Create an existing, isolated `PUBLIC_HTML_DIR` and keep the private storage root outside it.

**Why:** The route constructs its storage service during import, and local private storage rejects a missing public root or one located inside `public_html`; importing too early fails before the API route can be exercised.

**How to apply:** In tests, create temporary public/private directories, set the local-storage environment first, create the public root, then dynamically import and mount the real storage routers. Restore environment variables and remove temporary files afterward.
