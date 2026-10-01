---
name: sms.net.bd API contract
description: Provider documentation location and request behavior for the OTP SMS gateway.
---

The provider website may redirect from `sms.net.bd` to `sms.bd`; current API documentation is at `https://sms.bd/api`, while the send endpoint remains `https://api.sms.net.bd/sendsms`. The docs support GET and POST, JSON requests and responses, the required `api_key`, `msg`, and `to` fields, Bangladesh numbers beginning with `880` or local `01`, and success responses with `error: 0`.

The backend accepts `SMS_NET_BD_API_URL` as an optional override, defaulting to the documented endpoint. Because the API key is sent in the POST body, validate overrides to HTTPS on the exact `api.sms.net.bd/sendsms` endpoint; never allow an arbitrary host, query, or credentials. OTP logs may include a failure stage, safe error code, HTTP status, or numeric provider error code, but must exclude phone numbers, OTPs, API keys, and provider response bodies.

**Why:** Managed web search returned a payment error during integration work, but fetching the provider's own documentation directly resolved the request contract and domain redirect. The API key is transmitted in the request body, so an unrestricted configurable URL would make a configuration mistake capable of leaking the key.

**How to apply:** Verify the provider's current documentation before changing SMS delivery. Prefer POST JSON to keep credentials out of URLs, constrain any gateway override to the provider's approved HTTPS endpoint, and log only safe diagnostic fields.