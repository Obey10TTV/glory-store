const test = require('node:test')
const assert = require('node:assert/strict')
const Product = require('../models/product')
const Promotion = require('../models/promotion')
const {
  getMarketplaceConfig,
  getPromotionPlan,
  getSellerPlans,
  pricePromotionForSeller
} = require('../services/marketplaceService')

test('classified marketplace mode is the safe default', () => {
  const config = getMarketplaceConfig()
  assert.equal(config.marketplaceMode, 'classified')
  assert.equal(config.directCheckoutEnabled, false)
})

test('public product JSON never exposes private listing evidence', () => {
  const product = new Product({
    name: 'Barrier Repair Serum',
    price: 24,
    description: 'A fragrance-free serum with a simple routine-friendly texture.',
    category: 'Skincare',
    image: 'https://example.com/serum.jpg',
    brand: 'Glow Lab',
    countInStock: 4,
    listingEvidence: {
      status: 'submitted',
      condition: 'new_sealed',
      packagingPhotosConfirmed: true,
      batchCode: 'LOT-2026-GLORY',
      expiryOrPao: '12M after opening',
      supplierInvoiceAvailable: true,
      supplierInvoiceReference: 'INV-PRIVATE-2026',
      safetyDocumentationAvailable: true,
      responsiblePersonName: 'Glow Lab UK Ltd',
      declarationAccepted: true
    }
  })

  const publicProduct = product.toJSON()
  assert.equal(publicProduct.listingEvidence.status, 'submitted')
  assert.equal(publicProduct.listingEvidence.condition, 'new_sealed')
  assert.equal(publicProduct.listingEvidence.batchCode, undefined)
  assert.equal(publicProduct.listingEvidence.expiryOrPao, undefined)
  assert.equal(publicProduct.listingEvidence.supplierInvoiceAvailable, undefined)
  assert.equal(publicProduct.listingEvidence.supplierInvoiceReference, undefined)
  assert.equal(publicProduct.listingEvidence.safetyDocumentationAvailable, undefined)
  assert.equal(publicProduct.listingEvidence.responsiblePersonName, undefined)
  assert.equal(publicProduct.listingEvidence.packagingPhotosConfirmed, undefined)
  assert.equal(publicProduct.listingEvidence.declarationAccepted, undefined)
})

test('homepage promotion pricing is server controlled', () => {
  const plan = getPromotionPlan('homepage_spotlight_7')
  assert.equal(plan.placement, 'homepage_featured')
  assert.equal(plan.currency, 'GBP')
  assert.ok(Number.isInteger(plan.feePence) && plan.feePence >= 100)
  assert.ok(Number.isInteger(plan.durationDays) && plan.durationDays >= 1)
})

test('seller plans preserve a free entry tier while charging for scale', () => {
  const plans = getSellerPlans()
  assert.deepEqual(plans.map(plan => plan.code), ['starter', 'studio', 'scale', 'partner'])
  assert.equal(plans[0].feePence, 0)
  assert.equal(plans[0].activeListingLimit, 5)
  assert.equal(plans[1].feePence, 5900)
  assert.equal(plans[2].feePence, 14900)
  assert.equal(plans[3].feePence, 39900)
})

test('promotion discounts are calculated on the server from an active membership', () => {
  const plan = getPromotionPlan('homepage_spotlight_7')
  const price = pricePromotionForSeller(plan, {
    membershipPlanCode: 'scale',
    membershipStatus: 'active'
  })
  assert.equal(price.baseFeePence, 8900)
  assert.equal(price.discountPence, 1780)
  assert.equal(price.feePence, 7120)
  assert.equal(price.sellerPlanCode, 'scale')
})

test('public promotion JSON never exposes payment references', () => {
  const promotion = new Promotion({
    seller: '65b4b77696529734830f1101',
    listing: '65b4b77696529734830f1102',
    placement: 'homepage_featured',
    planCode: 'homepage_spotlight_7',
    label: 'Homepage featured placement',
    baseAmountPence: 8900,
    amountPence: 999,
    currency: 'GBP',
    durationDays: 7,
    paymentReference: 'cs_test_private_reference',
    paymentIntentId: 'pi_private_reference'
  })

  const publicPromotion = promotion.toJSON()
  assert.equal(publicPromotion.paymentReference, undefined)
  assert.equal(publicPromotion.paymentIntentId, undefined)
})
