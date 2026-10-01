---
name: sms.net.bd API contract
description: Provider documentation location and request behavior for the OTP SMS gateway.
---

The provider website may redirect from `sms.net.bd` to `sms.bd`; current API documentation is at `https://sms.bd/api`, while the send endpoint remains `https://api.sms.net.bd/sendsms`. The docs support GET and POST, JSON requests and responses, the required `api_key`, `msg`, and `to` fields, Bangladesh numbers beginning with `880` or local `01`, and success responses with `error: 0`.

**Why:** Managed web search returned a payment error during integration work, but fetching the provider's own documentation directly resolved the request contract and domain redirect.

**How to apply:** Verify the provider's current documentation before changing SMS delivery. Prefer POST JSON to keep credentials out of URLs, and do not expose provider response bodies in errors.