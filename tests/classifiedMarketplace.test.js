const test = require('node:test')
const assert = require('node:assert/strict')
const Product = require('../models/product')
const { getMarketplaceConfig } = require('../services/marketplaceService')

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
      responsiblePersonName: 'Glow Lab UK Ltd',
      declarationAccepted: true
    }
  })

  const publicProduct = product.toJSON()
  assert.equal(publicProduct.listingEvidence.status, 'submitted')
  assert.equal(publicProduct.listingEvidence.condition, 'new_sealed')
  assert.equal(publicProduct.listingEvidence.batchCode, undefined)
  assert.equal(publicProduct.listingEvidence.responsiblePersonName, undefined)
  assert.equal(publicProduct.listingEvidence.packagingPhotosConfirmed, undefined)
  assert.equal(publicProduct.listingEvidence.declarationAccepted, undefined)
})
