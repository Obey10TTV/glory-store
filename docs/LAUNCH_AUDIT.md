# Glory launch audit

Audit date: 13 August 2026

Release status: **not approved for public commercial launch yet**. The code-level controls and automated browser audit pass, but the external, operational and legal gates below still require owner evidence.

## Automated results

- Backend: 36 Node tests covering sessions, CSRF, OTP/recovery codes, Google identity normalization, classified-marketplace boundaries, server-owned prices, plan discounts, multi-seller allocation legacy code, review integrity, seller secret redaction and Trust & Safety deadlines.
- Frontend production build: Vite build succeeds.
- Responsive Chromium: 36 routes pass at widths from 320px through 1440px, including authenticated buyer, seller and admin views.
- Responsive WebKit: the same 36 routes pass at iPhone/Safari widths from 320px through 1440px.
- Role/workflow audit: anonymous visitor, buyer, unverified seller, verified seller and administrator flows are covered.
- Interaction audit: primary CTA routing, seller signup, email OTP gate, Google control visibility, catalogue search/filter/deep link, mutual transaction confirmation, review submission, review moderation, safety SLA, cancelled checkout, catalogue outage, expired session and keyboard skip navigation are covered.
- A Safari carousel race discovered by the audit was fixed by remounting slide-specific actions and preserving their pointer-down destination.

## Security and trust controls present

- HttpOnly cookie sessions, refresh rotation, CSRF protection, rate limits, validation, output redaction, security headers and audit logging.
- Email OTP before local-email account activation and optional account 2FA; 2FA is required for sellers.
- Stripe Identity hosted document/selfie verification; Glory does not accept direct identity uploads.
- Seller and product evidence reviewed separately; seller plans cannot purchase verification.
- Safety reports receive severity, triage and resolution targets; high/critical reports can alert the configured Trust & Safety mailbox.
- Reviews require a mutually confirmed Glory interaction, receive equal moderation regardless of sentiment, expose a Verified interaction label and support confidential reports.
- Server-owned subscription and promotion prices, finite promotion inventory, subscription entitlement enforcement and automatic refund of a paid promotion that becomes ineligible before activation.

## Mandatory launch gates

1. **DPIA approval:** complete and sign `IDENTITY_VERIFICATION_DPIA.md`; approve the lawful basis, biometric condition, retention schedule, alternative verification route and Stripe vendor/transfer assessment.
2. **Legal approval:** a UK solicitor must approve Terms, Privacy, Seller Agreement, Reviews Policy, Paid Promotion Terms, consumer cancellation language and Online Safety Act processes.
3. **Finance/tax approval:** a UK accountant must decide VAT registration/treatment, price display, invoices, revenue recognition and promotion credits/refunds. Enable `STRIPE_AUTOMATIC_TAX` only after Stripe Tax is configured and reviewed.
4. **Live provider checks:** test Stripe subscriptions, billing portal, automatic tax, refunds, Identity and every signed webhook in Stripe live-mode test procedures; test Google OAuth on the final domain; test SMTP delivery and spam placement.
5. **Operational staffing:** assign Trust & Safety and privacy owners, configure `TRUST_SAFETY_EMAIL`, staff critical-report coverage and rehearse incident, appeal and account-deletion/redaction procedures.
6. **Production infrastructure:** restore Railway service, confirm `/api/health` and `/api/ready`, verify MongoDB backups/restore, configure monitoring/alerts, rotate any previously exposed secrets, and test Vercel-to-Railway CORS/cookies on the final origin.
7. **Accessibility/manual QA:** complete screen-reader checks, zoom/reflow, real-device touch testing, transactional email rendering and a human content review. Automated bounds checks do not replace assistive-technology testing.
8. **Business evidence:** validate prices with seller interviews and a small beta; set targets for conversion, churn, promotion fill, enquiries, support cost and Trust & Safety cost before scaling acquisition.

## Production smoke test

After Railway resumes and environment values are set:

1. Create a new buyer with email OTP and Google.
2. Create a seller, enable 2FA, complete hosted identity and approve the seller as admin.
3. Submit, reject, amend and approve a listing.
4. Open a real Stripe test subscription, change/cancel it in the portal and confirm webhook entitlement updates.
5. Buy, display, expire and refund a Spotlight campaign.
6. Exchange messages as buyer and seller, mutually confirm the transaction, submit positive and negative reviews, moderate both, report one and test appeal records.
7. Submit each safety-report category and confirm deadlines, email alerts, audit events, listing pause/removal and user communications.
8. Expire a session during a protected action and verify a clear return to login without data leakage.
