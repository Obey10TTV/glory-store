const test = require('node:test')
const assert = require('node:assert/strict')
const Product = require('../models/product')
const Promotion = require('../models/promotion')
const { getMarketplaceConfig, getPromotionPlan } = require('../services/marketplaceService')

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
  const plan = getPromotionPlan('homepage_featured')
  assert.equal(plan.placement, 'homepage_featured')
  assert.equal(plan.currency, 'GBP')
  assert.ok(Number.isInteger(plan.feePence) && plan.feePence >= 100)
  assert.ok(Number.isInteger(plan.durationDays) && plan.durationDays >= 1)
})

test('public promotion JSON never exposes payment references', () => {
  const promotion = new Promotion({
    seller: '65b4b77696529734830f1101',
    listing: '65b4b77696529734830f1102',
    placement: 'homepage_featured',
    planCode: 'homepage_featured',
    label: 'Homepage featured placement',
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
