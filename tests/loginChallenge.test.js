const test = require('node:test')
const assert = require('node:assert/strict')
const { createOtpChallenge, updateLoginChallenge } = require('../utils/otp')
const { validationResult } = require('express-validator')
const { validateUpdateProfile } = require('../middleware/security')

test('login challenge consumption is a conditional atomic write', async () => {
  const challenge = createOtpChallenge('123456')
  const hash = 'stored-recovery-code-hash'
  const user = { _id: 'user' }
  let active = true
  const User = {
    async findOneAndUpdate(filter, update, options) {
      assert.equal(filter._id, user._id)
      assert.equal(filter['twoFactor.enabled'], true)
      assert.equal(filter['twoFactor.login.codeHash'], challenge.codeHash)
      assert.equal(filter['twoFactor.login.lastSentAt'], challenge.lastSentAt)
      assert.ok(filter['twoFactor.login.expiresAt'].$gt instanceof Date)
      assert.equal(filter['twoFactor.login.attempts'].$lt, 5)
      assert.equal(filter['twoFactor.recoveryCodeHashes'], hash)
      assert.deepEqual(update, {
        $set: { 'twoFactor.login': {} },
        $pull: { 'twoFactor.recoveryCodeHashes': hash }
      })
      assert.equal(options.new, true)
      if (!active) return null
      active = false
      return user
    }
  }
  const attempt = () => updateLoginChallenge(User, {
    userId: user._id,
    path: 'twoFactor.login',
    challenge,
    valid: true,
    conditions: { 'twoFactor.enabled': true, 'twoFactor.recoveryCodeHashes': hash },
    pull: { 'twoFactor.recoveryCodeHashes': hash }
  })

  assert.deepEqual(await Promise.all([attempt(), attempt()]), [user, null])
})

test('failed verification increments attempts without clearing the challenge', async () => {
  const challenge = createOtpChallenge('123456')
  const User = {
    async findOneAndUpdate(filter, update) {
      assert.equal(filter.isEmailVerified, false)
      assert.equal(filter['emailVerification.codeHash'], challenge.codeHash)
      assert.deepEqual(update, { $inc: { 'emailVerification.attempts': 1 } })
    }
  }

  await updateLoginChallenge(User, {
    userId: 'user',
    path: 'emailVerification',
    challenge,
    valid: false,
    conditions: { isEmailVerified: false }
  })
})

test('password changes require the current password while name-only edits still work', async () => {
  const validate = async (body) => {
    const req = { body }
    for (const rule of validateUpdateProfile) await rule.run(req)
    return validationResult(req).array().map((error) => error.path)
  }
  assert.deepEqual(await validate({ name: 'Glory Seller' }), [])
  assert.deepEqual(await validate({ password: 'NewPass123!' }), ['currentPassword'])
  assert.deepEqual(await validate({ password: 'NewPass123!', currentPassword: 'OldPass123!' }), [])
})
