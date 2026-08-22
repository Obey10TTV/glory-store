# Glory Security Audit

Date: 2026-08-20

## Scope and architecture

- Frontend: React 19 and Vite, deployed on Vercel.
- API: Express 4 on Railway, using cookie-based access and refresh sessions.
- Data: MongoDB via Mongoose. No ORM other than Mongoose.
- Storage: Cloudinary. Seller documents use authenticated storage; government ID uploads are rejected and Stripe Identity is used instead.
- Payments: Stripe and Paystack webhooks use raw-body signature verification.
- Identity: Google ID-token verification is server-side. Email OTP is used for verification and current two-factor authentication.
- Email: SMTP through Nodemailer.
- CI/CD, Docker, Redis, WAF, backup settings, Atlas network rules, Vercel and Railway dashboards: not present in either repository.

## Findings

### CRITICAL: historic environment-file exposure requires full credential rotation

1. Vulnerability: Git history records an environment-file removal commit. Even though the current tree ignores `.env`, any credential that appeared in historic commits must be treated as exposed.
2. Attack scenario: anyone with repository history or a prior clone could retain a credential and access a provider if network or account controls permit it.
3. Affected files: historic `.env` commit; no secret value is reproduced in this document or current tracked files.
4. Impact: database, payment, email, storage, OAuth or session-signing compromise depending on the historic contents.
5. Remediation: rotate every credential that could have appeared there, revoke unused users/tokens, restrict Atlas Network Access, replace values only in Railway/Vercel secrets, and enable GitHub secret scanning. Consider history rewriting only after preserving an incident record and coordinating with all collaborators.
6. Implemented: no. Credential rotation is an operator action and cannot be safely performed from source code.
7. Remaining risk: critical until rotation and Atlas access review are confirmed.

### HIGH: in-memory rate limits are not shared across instances

1. Vulnerability: `express-rate-limit` and IP anomaly maps are process-local.
2. Attack scenario: an attacker spreads requests across Railway replicas or waits for a restart to reset counters.
3. Affected files: `middleware/security.js`, `server.js`.
4. Impact: login, OTP, upload, payment, and scraping controls can be bypassed at scale.
5. Remediation: use Redis/Upstash or Railway Redis as the shared rate-limit store and enforce provider-side quotas.
6. Implemented: partially. Per-account HMAC keyed limits, endpoint limits, bounded in-memory tracking, and 429 responses are implemented. A distributed store is not configured.
7. Remaining risk: HIGH until a shared store is configured before horizontal scaling.

### HIGH: administrator role elevation was too broadly available

1. Vulnerability: any administrator could promote another account and one duplicate role-promotion endpoint existed in the general users router.
2. Attack scenario: a compromised ordinary admin creates a durable privileged account.
3. Affected files: `routes/adminRoutes.js`, `routes/userRoutes.js`, `middleware/auth.js`, `models/user.js`.
4. Impact: privilege escalation and persistent administrative access.
5. Remediation: separate Super Admin role, require MFA-backed server-side privilege checks, audit role changes, and retire the duplicate endpoint.
6. Implemented: yes. Only `isSuperAdmin` with enabled MFA can grant administrator status; the general endpoint now returns 410 and grants are audit logged.
7. Remaining risk: manually seed exactly one Super Admin through private Atlas access and protect it with MFA. Do not expose a bootstrap endpoint.

### HIGH: upload MIME checks could be spoofed

1. Vulnerability: upload filtering originally trusted the client-supplied MIME type.
2. Attack scenario: an attacker submits active content disguised as an image or invalid media to consume Cloudinary processing.
3. Affected files: `routes/uploadRoutes.js`.
4. Impact: stored-content abuse, costly processing, and content-type confusion.
5. Remediation: allowlist formats, verify magic bytes, randomize storage names, use authenticated storage for documents, and avoid returning storage identifiers.
6. Implemented: yes for JPG, PNG, WebP, PDF, MP4 and WebM. SVG is rejected; magic bytes are verified and Cloudinary public IDs are not returned to clients.
7. Remaining risk: add malware scanning and Cloudinary moderation for production scale.

### MEDIUM: JWT validation lacked explicit issuer/audience restrictions

1. Vulnerability: access tokens used expiry and signature verification but not issuer/audience checks.
2. Attack scenario: token confusion becomes more likely if another service shares a signing secret by mistake.
3. Affected files: `utils/authSession.js`, `middleware/auth.js`.
4. Impact: token acceptance beyond the intended Glory service boundary.
5. Remediation: pin algorithm, issuer and audience; require separate strong JWT and OTP secrets.
6. Implemented: yes. HS256, issuer and audience are enforced, and production refuses to boot with missing, short, or reused JWT/OTP secrets.
7. Remaining risk: rotate signing secrets with a planned overlapping-key migration when needed.

### MEDIUM: production CORS included development origins

1. Vulnerability: localhost origins were always permitted.
2. Attack scenario: a browser on an administrator workstation could be induced to make credentialed requests from a local malicious service.
3. Affected files: `server.js`.
4. Impact: unnecessary cross-origin attack surface.
5. Remediation: use environment-specific allowlists and validate browser Origin on unsafe methods.
6. Implemented: yes. Production excludes localhost by default and unsafe browser requests from unknown origins are rejected. Signed webhooks remain originless by design.
7. Remaining risk: configure every real Vercel custom domain explicitly in `CORS_ORIGINS`.

### MEDIUM: session and privileged access assurance needed strengthening

1. Vulnerability: sessions had absolute expiration but no idle expiry, and admin actions did not require MFA.
2. Attack scenario: a dormant stolen session remains usable or an admin account without a second factor performs sensitive work.
3. Affected files: `models/user.js`, `utils/authSession.js`, `middleware/auth.js`.
4. Impact: account and moderator-console compromise.
5. Remediation: short access tokens, rotated refresh tokens, revocation, idle expiry, MFA and separate Super Admin control.
6. Implemented: yes for 15-minute access cookies, refresh rotation, server-side session revocation, configurable 24-hour idle expiry, and MFA-gated admin access.
7. Remaining risk: current MFA is email OTP. Add WebAuthn/passkeys or TOTP before broad administrator use.

### MEDIUM: internal errors could be returned by route-level catch blocks

1. Vulnerability: several route handlers returned `error.message` directly.
2. Attack scenario: database or provider errors disclose implementation details.
3. Affected files: route handlers and `server.js`.
4. Impact: reconnaissance support for attackers.
5. Remediation: central production redaction and structured internal logging.
6. Implemented: yes. Production JSON responses with a 5xx status are replaced by a generic message and request ID. Logs strip database URLs and common payment-secret patterns.
7. Remaining risk: add a hosted log sink with alerting; Railway filesystem logs are not a durable audit store.

### LOW: no CI security pipeline or secret scanner is configured

1. Vulnerability: no repository workflow runs SAST, dependency, or secret scans on pull requests.
2. Attack scenario: a future change introduces a vulnerability or secret without an automated gate.
3. Affected files: repository configuration.
4. Impact: regression risk.
5. Remediation: protected branches plus GitHub secret scanning, Dependabot, CodeQL, and a non-production ZAP baseline workflow.
6. Implemented: no workflow was added because deployment credentials and branch policy need repository-owner configuration.
7. Remaining risk: low to medium depending on release discipline.

### INFORMATIONAL: frontend state is attacker-controlled by design

1. Vulnerability: user profile, market choice, cart, wishlist and CSRF token are browser storage values.
2. Attack scenario: a user changes `isAdmin` or a cart value in DevTools.
3. Affected files: frontend `src/context/*`, `src/App.jsx`.
4. Impact: UI-only behavior can change; server authorization must not.
5. Remediation: backend identity, object ownership and role enforcement for every sensitive endpoint.
6. Implemented: existing server-side checks were reviewed; this audit strengthened role and session enforcement. No bearer token is stored in browser storage.
7. Remaining risk: frontend route guards remain UX only, as they should.

## Validation completed

- Backend tests: 43 passing.
- Backend production dependency audit: 0 known vulnerabilities.
- Frontend dependency audit: 0 known vulnerabilities.
- Current tracked-file secret pattern scan found no verified runtime secret values. Historical matching needs a dedicated secret-scanning service because code examples and dependency references create false positives.

## Security scorecard

| Control | Status | Notes |
| --- | --- | --- |
| Authentication | PARTIAL | Strong cookies, rotation, OTP; no breached-password service or passkeys. |
| Authorization | PARTIAL | Server-enforced roles and ownership reviewed; no centralized policy engine. |
| IDOR/BOLA | PARTIAL | Key routes enforce ownership; full integration matrix still required. |
| Admin security | PARTIAL | MFA and Super Admin gates added; passkeys and step-up reauth remain. |
| API security | PARTIAL | Validation, headers, CORS, CSRF and limits in place. |
| Rate limiting | PARTIAL | Endpoint and account controls are local only. |
| Cost protection | PARTIAL | Payment/upload limits exist; shared quotas and budgets need provider setup. |
| Identity protection | PARTIAL | Hosted ID flow and private documents; retention and DPIA operations remain. |
| Database security | PARTIAL | Mongoose validation and private Atlas recommendation; Atlas configuration unverified. |
| Network security | PARTIAL | Only HTTP app listener visible in code; Railway/Atlas network posture unverified. |
| Secrets | PARTIAL | Ignored env files and config checks; rotate disclosed MongoDB credential. |
| Uploads | PARTIAL | Signature validation and private document storage; malware scanning absent. |
| XSS | PARTIAL | React escaping, input sanitization and CSP; CSP reporting absent. |
| CSRF | PASS | Double-submit token, Origin defense and SameSite cookies. |
| Injection | PARTIAL | Mongo sanitize, HPP and validation; full integration injection tests pending. |
| SSRF | PASS | No application URL-fetch feature was found. |
| Logging | PARTIAL | Redaction and audit log model; durable sink not configured. |
| Monitoring | FAIL | Alerts, SIEM, uptime and billing alarms require hosted configuration. |
| Dependencies | PASS | Both current production audits report zero known vulnerabilities. |
| Infrastructure | PARTIAL | Vercel headers and Railway code reviewed; dashboard controls not verifiable here. |
| Backups | FAIL | Atlas backup and restore testing not evidenced in the repository. |
| Incident response | PARTIAL | Runbook added; contacts and exercises still required. |
