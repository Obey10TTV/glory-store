# Resend setup for Glory account emails

Glory supports Resend through its secure SMTP endpoint. Do not commit a Resend API key to GitHub or expose it to the frontend.

## Before real email testing

1. Create a Resend account.
2. Add and verify the sending domain you want Glory to use.
3. Create a server-side Resend API key.
4. Add these variables to the backend host:

```text
RESEND_API_KEY=re_...
EMAIL_FROM=Glory <accounts@your-verified-domain.example>
```

The sender in `EMAIL_FROM` must belong to the domain verified in Resend. Leave the generic `SMTP_*` variables empty when using Resend.

## Safe test sequence

1. Register a new buyer and confirm that the six-digit code arrives.
2. Verify the buyer and confirm that the session opens.
3. Register a new seller with a brand name and repeat verification.
4. Request one replacement code and confirm the previous code no longer works.
5. Confirm the 60-second resend cooldown is enforced.
6. Check Resend delivery logs for delivery, bounce or rejection events.

If delivery fails, Glory keeps the unverified account recoverable and shows the verification/resend screen instead of claiming that registration never happened.
