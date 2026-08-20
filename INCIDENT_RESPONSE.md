# Glory Incident Response

## First hour

1. Assign an incident lead and record times, affected accounts and decisions in a private incident log.
2. Contain: revoke affected Railway/Vercel/Atlas/provider sessions and API keys; disable risky API routes or payments if necessary.
3. Rotate exposed secrets. Treat any disclosed MongoDB, Stripe, Paystack, Cloudinary, SMTP, Google OAuth or JWT secret as compromised.
4. Revoke affected Glory sessions using the account session controls or Atlas admin procedure, then require password reset and MFA reset where appropriate.
5. Preserve evidence: Railway logs, Vercel deployment logs, Atlas audit data, Cloudinary access records and payment webhook IDs. Do not alter original evidence.

## Incident playbooks

### Suspected account takeover

- Revoke all sessions, reset credentials, disable payout/promotion changes, preserve audit events, and notify the account owner.

### Exposed database or provider secret

- Rotate at the provider first, update Railway secrets, redeploy, invalidate related sessions or webhooks, and verify the old credential no longer works. Review logs for use of the old credential.

### Fraudulent listing or identity-document access

- Pause the listing/seller, preserve the report and audit trail, revoke signed document links, review all admin access, and follow the Trust & Safety SLA.

### Payment webhook anomaly

- Disable webhook processing if needed, reconcile provider events against stored idempotency records, and never manually mark orders or promotions paid from a browser screen.

## Communications and recovery

- Obtain legal/privacy advice for any suspected personal-data breach and meet applicable notification timelines.
- Notify affected users with factual scope, actions taken, and concrete next steps.
- Restore only from a tested backup, validate integrity in staging, then monitor for repeat activity.
- Run a post-incident review within five business days and track corrective actions to closure.
