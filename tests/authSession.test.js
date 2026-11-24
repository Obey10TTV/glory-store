const test = require('node:test')
const assert = require('node:assert/strict')
const { createRefreshToken, hashToken, rotateRefreshSession, safeEqual, SESSION_IDLE_MS } = require('../utils/authSession')
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

test('refresh rotation conditionally replaces an active token only once', async () => {
  const refreshToken = createRefreshToken()
  const now = new Date('2026-11-24T12:00:00.000Z')
  let storedHash = hashToken(refreshToken)
  const User = {
    async findOneAndUpdate(filter, update, options) {
      const session = filter.authSessions.$elemMatch
      assert.equal(session.expiresAt.$gt, now)
      assert.deepEqual(session.$or, [
        { lastUsedAt: { $gt: new Date(now.getTime() - SESSION_IDLE_MS) } },
        { lastUsedAt: null, createdAt: { $gt: new Date(now.getTime() - SESSION_IDLE_MS) } }
      ])
      assert.equal(update.$set['authSessions.$.lastUsedAt'], now)
      assert.equal(options.new, true)
      if (session.tokenHash !== storedHash) return null
      storedHash = update.$set['authSessions.$.tokenHash']
      return { authSessions: [{ sessionId: 'session', tokenHash: storedHash }] }
    }
  }

  const [winner, consumed] = await Promise.all([
    rotateRefreshSession(User, refreshToken, now),
    rotateRefreshSession(User, refreshToken, now)
  ])
  assert.equal(winner.sessionId, 'session')
  assert.equal(hashToken(winner.refreshToken), storedHash)
  assert.equal(consumed, null)
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
