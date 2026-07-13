const test = require('node:test')
const assert = require('node:assert/strict')
const { createRefreshToken, hashToken, safeEqual } = require('../utils/authSession')
const { generateRecoveryCodes, hashRecoveryCode, consumeRecoveryCode } = require('../utils/otp')

test('refresh tokens are random and only stable after hashing', () => {
  const first = createRefreshToken()
  const second = createRefreshToken()
  assert.notEqual(first, second)
  assert.equal(first.length >= 64, true)
  assert.equal(hashToken(first), hashToken(first))
  assert.notEqual(hashToken(first), hashToken(second))
})

test('constant-time token comparison rejects mismatches', () => {
  assert.equal(safeEqual('matching-token', 'matching-token'), true)
  assert.equal(safeEqual('matching-token', 'different-token'), false)
  assert.equal(safeEqual('short', 'much-longer'), false)
})

test('recovery codes are unique and consumed only once', () => {
  const codes = generateRecoveryCodes()
  assert.equal(codes.length, 8)
  assert.equal(new Set(codes).size, 8)
  const hashes = codes.map(hashRecoveryCode)
  const firstUse = consumeRecoveryCode(hashes, codes[0].toLowerCase())
  assert.equal(firstUse.valid, true)
  assert.equal(firstUse.hashes.length, 7)
  assert.equal(consumeRecoveryCode(firstUse.hashes, codes[0]).valid, false)
})
