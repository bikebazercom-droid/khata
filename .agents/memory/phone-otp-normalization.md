---
name: Phone OTP normalization and lifetime
description: Canonical Bangladesh phone handling, localized OTP digits, and the sign-in code expiry policy.
---

Phone OTPs are valid for 15 minutes. Keep the SMS copy, server-side expiry, and sign-in UI notice synchronized. Normalize Bengali OTP digits to ASCII before hashing/comparison, and normalize Bangladesh phone input to `+880…` for both OTP creation and verification; the SMS gateway receives the same number without the leading plus.

**Why:** SMS delivery and manual entry can take longer on mobile, and a Bengali numeric keyboard can otherwise turn an apparently valid six-digit code into a different string.

**How to apply:** When changing phone sign-in, preserve the same normalization for send and verify, accept Bengali digits as well as ASCII, and update all user-facing expiry text with the server TTL.
