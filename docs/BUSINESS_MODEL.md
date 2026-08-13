# Glory commercial model

Status: operating proposal implemented in code; finance and legal approval required before live billing.

## Commercial principle

Glory is a classified beauty marketplace. It does not take buyer-to-seller payment, hold funds, fulfil orders or earn a sales commission in classified mode. Revenue comes from seller software capacity and clearly labelled visibility. Verification, moderation and trust badges cannot be purchased.

## Seller plans

| Plan | Monthly price | Active listings | Visibility discount | Intended seller |
| --- | ---: | ---: | ---: | --- |
| Starter | Free | 5 | 0% | New and testing the marketplace |
| Studio | GBP 59 | 50 | 10% | Growing independent store |
| Scale | GBP 149 | 200 | 20% | Established catalogue |
| Brand Partner | GBP 399 | 750 | 25% | High-volume brand with campaign support |

An activation charge is disabled by default. If Glory later introduces one, it must fund a clearly described onboarding service and be displayed consistently in checkout, pricing, seller terms and invoices. It must never be described as buying verification.

Listing capacity is enforced at creation and public visibility. When a paid entitlement ends, listings over the effective plan limit remain in the seller dashboard but are paused from public discovery. Eligible listings are restored up to the new limit after an upgrade.

## Paid visibility

| Product | Price | Duration | Inventory |
| --- | ---: | ---: | ---: |
| Homepage Spotlight | GBP 89 | 7 days | Shared capacity of 8 simultaneous placements |
| Homepage Spotlight 30 | GBP 249 | 30 days | Shared capacity of 8 simultaneous placements |

The backend owns every price, applies plan discounts, labels public placements as Sponsored and reserves a finite slot before opening payment. This prevents a client from altering a fee and prevents Glory from selling more homepage placements than it can display.

If a listing becomes unapproved, out of stock or plan-paused between checkout creation and payment confirmation, the backend cancels the placement, releases the reserved slot and requests an idempotent Stripe refund.

## Illustrative monthly model

This is a planning scenario, not a forecast or promise:

- 25 Studio sellers x GBP 59 = GBP 1,475
- 10 Scale sellers x GBP 149 = GBP 1,490
- 5 Brand Partner sellers x GBP 399 = GBP 1,995
- 30 seven-day Spotlight campaigns x GBP 89 = GBP 2,670
- Illustrative gross monthly revenue = GBP 7,630

At 500 sellers, the model should be rebuilt from observed conversion, churn, promotion fill rate, support cost and seller outcomes. Do not raise prices merely to appear premium; charge where Glory creates measurable catalogue capacity, discovery or operating support.

## Unit-economics controls

- Track monthly recurring revenue, annualised recurring revenue, paid-plan conversion, churn and failed renewals.
- Track promotion sell-through, impressions, listing views, enquiries and cost per enquiry without promising sales.
- Track identity-verification cost, moderation time, support cost and fraud loss per verified seller.
- Track gross revenue separately from VAT, payment-processing fees, refunds, credits and operating costs.
- Use Stripe Tax or an accountant-approved process before billing sellers in multiple tax jurisdictions.

As checked on 13 August 2026, Stripe's public UK standard pricing lists 1.5% + 20p for standard UK cards, and Stripe Identity lists GBP 1.25 per completed verification with the first 50 included. Provider prices can change and must be read from current contracts before forecasts are approved.

## Launch decisions still required

1. Decide whether public prices include or exclude VAT and configure invoices accordingly.
2. Approve subscription renewal, cancellation, failed-payment and refund rules with a UK solicitor.
3. Approve a promotions credit/refund rule for downtime or a Glory-caused interruption.
4. Define managed campaign scope and response times for Brand Partner sellers.
5. Set a quarterly pricing review based on seller value, demand and operating cost.
6. Add board/accountant-approved budgets for Trust & Safety, customer support, insurance and legal work.

Sources: https://stripe.com/gb/pricing and https://stripe.com/gb/identity
