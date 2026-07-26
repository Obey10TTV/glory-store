const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isUnitedKingdom,
  isValidInternationalPhone,
  isValidUkPhone,
  isValidUkPostcode
} = require('../middleware/security')

test('recognises common United Kingdom destination names', () => {
  assert.equal(isUnitedKingdom('United Kingdom'), true)
  assert.equal(isUnitedKingdom('UK'), true)
  assert.equal(isUnitedKingdom('Canada'), false)
})

test('validates UK postcodes without rejecting international postal formats', () => {
  assert.equal(isValidUkPostcode('SW1A 1AA'), true)
  assert.equal(isValidUkPostcode('M1 1AE'), true)
  assert.equal(isValidUkPostcode('A1A 1A1'), false)
})

test('accepts UK and international phone formats safely', () => {
  assert.equal(isValidUkPhone('07123 456789'), true)
  assert.equal(isValidUkPhone('+44 7123 456789'), true)
  assert.equal(isValidUkPhone('(416) 555-0123'), false)
  assert.equal(isValidInternationalPhone('+1 416 555 0123'), true)
  assert.equal(isValidInternationalPhone('+234 801 234 5678'), true)
})
