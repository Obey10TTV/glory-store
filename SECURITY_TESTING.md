# Security Testing

## Automated tests included

Run from `C:\Users\ADMIN\OneDrive\Desktop\glory-store`:

```powershell
npm test
npm audit --omit=dev
```

The current suite covers session token hashing/rotation primitives, CSRF, Google token normalization, seller privacy serialization, payments and idempotency, review integrity, taxonomy validation, marketplace pricing, JWT issuer/audience, origin enforcement, upload signature checks, MFA-backed admin checks and review audit records.

## Mandatory staging test matrix before launch

Use an isolated database and test accounts. Do not run intrusive tests against production.

| Scenario | Expected result |
| --- | --- |
| Unauthenticated access to private API | 401 without sensitive fields. |
| Buyer A reads, edits or deletes Buyer B resource | 403 or non-enumerating 404. |
| Seller A accesses Seller B documents/listings | 403 or 404. |
| Browser changes `localStorage.isAdmin` | UI may change, API admin calls remain 403. |
| Request submits `isAdmin`, `sellerId`, approval or payment fields | Fields are ignored or rejected server-side. |
| Invalid/expired/wrong-audience access token | 401. |
| Bad CSRF token or evil Origin | 403. |
| Login/OTP/upload floods | 429 with `RateLimit`/`Retry-After` response headers. |
| SVG or renamed executable upload | 400. |
| Unsupported huge page value | server caps pagination. |
| Changed promotion amount, plan, listing ID or payment reference | server recomputes trusted values and rejects unauthorized ownership. |
| Unsigned/altered payment webhook | 401/400 with no state change. |
| Buyer and seller interaction review | only confirmed conversation buyer can create one review. |

## Tools to add in CI

- GitHub secret scanning and push protection.
- Dependabot and `npm audit --omit=dev`.
- CodeQL JavaScript analysis.
- OWASP ZAP baseline scan against a staging URL only.
- A Playwright launch suite for 320px through desktop, keyboard paths and Safari/WebKit.
- MongoDB backup restore drill at least quarterly.

## Test limitations

The unit tests do not replace a full integration test database. Before launch, add Supertest or equivalent tests with seeded User A/User B/Seller/Admin accounts for every private route, especially document access, payments, promotions, disputes and admin moderation.
