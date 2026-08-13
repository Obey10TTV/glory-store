# Draft DPIA: seller identity verification

Status: draft for the controller, DPO/privacy adviser and UK legal counsel. It is not an approved DPIA and live identity checks must not be enabled until the sign-off section is completed.

## Processing in scope

Glory asks a seller to complete a hosted Stripe Identity document-and-selfie check before final seller approval. Accepted document types are passport, driving licence and identity card. Glory records the provider, Verification Session identifier, status, consent/disclosure timestamp, check timestamps and error category. Glory does not receive or store document images in its application database.

National Insurance numbers must not be requested or used as identity documents. Sellers must not email identity documents to support. A proportionate alternative route should be documented for people who cannot complete the hosted check.

## Purpose and necessity

The purpose is to reduce impersonation, repeat abuse and fraudulent seller accounts on a marketplace where buyers transact directly with sellers. A simple email check is insufficient for the seller-risk profile. Identity verification does not prove product authenticity, business compliance or future good behaviour, so it remains one part of a layered assessment.

## Data flow

1. An authenticated seller verifies email, enables 2FA and reads the specific privacy disclosure.
2. Glory creates a Stripe Identity Verification Session containing only Glory's user identifier and a purpose code in metadata.
3. The seller enters Stripe's hosted flow. Stripe collects and checks the document and selfie.
4. Signed Stripe webhooks update Glory with the session status.
5. An administrator sees only the result and timestamps when reviewing the seller.
6. An approved account-deletion workflow can request provider redaction when retention is no longer necessary.

## Data subjects and data categories

- Data subjects: prospective and active sellers.
- Glory-held data: account identifier, provider session identifier, verification state, timestamps and limited error reason.
- Provider-held data: identity-document data, document images, facial/selfie data, device and fraud signals as described by Stripe.
- Special/high-risk characteristics: biometric comparison and official identity documents create a high risk to rights and freedoms if misused.

## Lawful basis and transparency

The controller and legal adviser must select and document the UK GDPR Article 6 basis. Explicit interface acceptance records that the notice was seen, but consent must not be treated as the lawful basis merely because a checkbox exists. Any biometric processing condition and relevant Schedule 1 condition must be confirmed by counsel. The privacy notice must identify Glory and Stripe, purposes, categories, retention, rights, international transfers and complaint routes.

## Key risks and controls

| Risk | Control | Residual action |
| --- | --- | --- |
| Document breach in Glory | Hosted provider; no raw documents in MongoDB, Cloudinary, logs or email | Add automated secret/PII scanning and verify logs quarterly |
| Provider account compromise | Restricted Stripe keys, MFA, least privilege, webhook signatures and audit logs | Document key-rotation and incident response owners |
| Excessive collection | Fixed document types, matching selfie only, no NI number | Review requested checks annually |
| Incorrect rejection or bias | Human review, alternative route, appeal and no automatic seller ban from one provider result | Measure failure and appeal outcomes by region/document type lawfully |
| Indefinite retention | Provider redaction endpoint linked to approved deletion workflow | Approve exact retention schedule and periodic deletion job |
| Unclear transparency | Just-in-time seller disclosure plus full privacy notice | User-test the notice before launch |
| International transfer | Stripe contract and transfer documentation | Record applicable DPA/SCC/UK Addendum in vendor register |

## Rights and incident handling

Privacy requests must cover the Glory-held session record and be routed to Stripe where provider-held data is in scope. Restriction or deletion requests must not erase evidence needed for an active fraud investigation, legal claim or safety dispute without legal review. A suspected identity-data incident is escalated immediately to the privacy lead for the UK breach-assessment timeline.

## Approval record

- Controller owner: [not assigned]
- Privacy/DPO review: [pending]
- Security review: [pending]
- UK legal review: [pending]
- Vendor/DPA review: [pending]
- Approved retention period: [pending]
- Approval date and next review: [pending]

Reference: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/
