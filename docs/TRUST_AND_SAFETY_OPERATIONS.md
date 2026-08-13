# Glory Trust & Safety operations

Status: launch runbook requiring named staff, on-call coverage and legal approval.

## Safety-report service levels

| Priority | Examples | First triage | Target decision |
| --- | --- | ---: | ---: |
| Critical | Unsafe product, suspected counterfeit | 1 hour | 24 hours |
| High | Suspected scam, prohibited item | 4 hours | 72 hours |
| Standard | Misleading listing, stolen content, other | 24 hours | 7 days |

The API assigns these deadlines when a listing report is created. The admin queue shows priority, due time and breached state. A deadline is an internal operational target, not a promise that every investigation can be concluded without further evidence.

## Report handling

1. Confirm the report category, affected listing and immediate risk.
2. Preserve relevant listing and conversation records. Do not download identity documents.
3. Pause a listing when continued visibility creates a credible safety risk; do not remove content merely because one unsupported report exists.
4. Ask the seller for focused evidence when needed and set a response deadline.
5. Record the decision, evidence considered and listing action in the admin note and audit trail.
6. Notify affected users in clear language and offer an appeal route where appropriate.
7. Escalate credible threats to life, child safety, organised fraud or legally prohibited goods to the designated lead and relevant authority.

## Review integrity

- Only a buyer in a Glory conversation can review, after buyer and seller both confirm the transaction.
- Both participants must have sent a message before confirmation is accepted.
- One buyer can submit one review for that confirmed conversation.
- Every review enters the same moderation queue, regardless of rating.
- Detection surfaces new accounts, rapid confirmation, duplicate text, repeated buyer-seller pairs and contact details. A signal informs human review and never determines the decision alone.
- Sellers cannot approve, edit or delete reviews. Authors can withdraw their own review.
- Published reviews show Verified interaction, not Verified purchase, because Glory does not process buyer payment.
- Members can report a published review. Moderators record whether the report was actioned or dismissed.
- An idempotent deployment migration removes legacy embedded product reviews and rebuilds ratings only from published reviews in the moderated collection.

## Fair moderation standard

Publish genuine feedback that is relevant and lawful, whether positive or negative. Reject or remove content only for a documented policy reason such as fabricated interaction, undisclosed conflict, incentive tied to sentiment, abuse, personal data or irrelevant content. Disagreement, embarrassment or commercial pressure is not a removal reason.

## Staffing and assurance gates

- Assign a Trust & Safety owner and an on-call contact before launch.
- Staff critical coverage for every period in which public listings are available.
- Review SLA breaches, reversal/appeal rates and false-positive patterns weekly during launch.
- Sample moderator decisions for consistency across star ratings and seller plans.
- Never give paid sellers a different safety or review-evidence standard.
- Maintain incident, law-enforcement, insurer and legal-escalation contacts outside the codebase.

Reference: https://www.gov.uk/government/publications/reviews-guidance-for-online-review-sites/reviews-guidance-for-online-review-sites
