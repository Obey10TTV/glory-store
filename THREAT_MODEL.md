# Glory Threat Model

## Assets

- Account credentials, sessions, recovery codes and MFA state.
- Seller identity-verification state and private business documents.
- Listings, moderation evidence, messages, reports, reviews and audit trails.
- Stripe, Paystack, Cloudinary, Google and SMTP credentials.
- Platform revenue data and promotion purchase state.

## Trust boundaries

1. Browser to Vercel: public code and all client state are untrusted.
2. Vercel rewrite or local browser to Railway: cookies, CSRF token and API requests cross this boundary.
3. Railway to MongoDB, Cloudinary, Stripe, Paystack, Google and SMTP: credentials remain server-side.
4. Administrator browser to administrative routes: higher-assurance boundary requiring server-side MFA role checks.

## Primary threats and controls

| Threat | Server-side control |
| --- | --- |
| DevTools role tampering | Backend loads the user from verified access session; roles in JSON are ignored. |
| IDOR/BOLA | Ownership checks on products, conversations, orders, reports, promotions and private documents. |
| Credential stuffing | IP and HMAC-account limits, generic login failure, email verification, MFA. |
| CSRF | HttpOnly cookies, double-submit CSRF token and unsafe-Origin allowlist. |
| Token theft/replay | Short access cookie, rotated opaque refresh token hash, server-side session revocation and idle/absolute expiry. |
| NoSQL injection | `express-mongo-sanitize`, strict validators, allowlisted update fields and bounded pagination. |
| XSS | React output escaping, input sanitization, CSP, `nosniff`, and no user HTML rendering. |
| Upload abuse | Size/type/magic-byte checks, random Cloudinary names, authenticated document storage. |
| KYC document access | Hosted government-ID verification, no direct identity upload, admin-only signed document access. |
| Payment spoofing | Provider signed raw-body webhook verification and server-owned prices. |
| Promotion fraud | Seller verification, plan checks, approved listing ownership, server-side status transitions. |
| Cost exhaustion | Endpoint limits and upload limits; shared limits, provider quotas and spending alerts still needed. |

## Assumptions and non-goals

- Glory is a marketplace host. It does not collect buyer-to-seller marketplace proceeds while direct checkout is disabled.
- Random object IDs are never treated as authorization.
- CORS, hidden routes and frontend guards are not security boundaries.
- DDoS resistance depends on Vercel, Railway and an optional WAF/CDN configuration outside this repository.
