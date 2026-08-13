const test = require('node:test')
const assert = require('node:assert/strict')
const {
  canonicalizeProductType,
  getProductTypes,
  isCosmeticsCategory,
  isValidProductType
} = require('../utils/catalogTaxonomy')

test('haircare taxonomy normalises a conditioner alias for catalogue navigation', () => {
  assert.equal(canonicalizeProductType('Haircare', 'conditioners'), 'Conditioner')
  assert.equal(isValidProductType('Haircare', 'Conditioner'), true)
  assert.equal(isValidProductType('Skincare', 'Conditioner'), false)
})

test('catalogue types remain scoped to their selected category', () => {
  assert.ok(getProductTypes('Haircare').includes('Conditioner'))
  assert.equal(getProductTypes('Unknown category').length, 0)
})

test('cosmetic evidence rules exclude non-cosmetic product categories', () => {
  assert.equal(isCosmeticsCategory('Skincare'), true)
  assert.equal(isCosmeticsCategory('Tools & Accessories'), false)
})
