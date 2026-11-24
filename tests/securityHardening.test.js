const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-that-is-long-enough-for-security-controls'
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret-that-is-long-enough-for-security-controls'

const { ACCESS_COOKIE, createAccessToken } = require('../utils/authSession')
const { getJwtSigningOptions, getJwtVerificationOptions } = require('../utils/runtimeSecurity')
const { getAllowedOrigins, requireTrustedBrowserOrigin } = require('../utils/originPolicy')
const { detectFileType, fileMatchesAllowedType, safeOriginalName } = require('../utils/fileValidation')
const { admin, superAdmin, seller, protect } = require('../middleware/auth')
const AuditLog = require('../models/auditLog')

test('access tokens are bound to Glory issuer, audience and the expected algorithm', () => {
  const token = createAccessToken('user-id', 'session-id')
  const payload = jwt.verify(token, process.env.JWT_SECRET, getJwtVerificationOptions())
  assert.equal(payload.type, 'access')
  assert.throws(
    () => jwt.verify(token, process.env.JWT_SECRET, { ...getJwtVerificationOptions(), audience: 'another-app' }),
    /audience invalid/
  )
})

test('production origin policy excludes local development origins', () => {
  const productionOrigins = getAllowedOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.glory.example' })
  assert.equal(productionOrigins.includes('http://localhost:3000'), false)
  assert.equal(productionOrigins.includes('https://app.glory.example'), true)
  assert.equal(getAllowedOrigins({ NODE_ENV: 'development' }).includes('http://localhost:3000'), true)
})

test('unsafe browser requests from untrusted origins are rejected while signed webhooks remain originless', () => {
  const run = ({ origin, url = '/api/users/profile' }) => {
    let statusCode
    let payload
    let nextCalled = false
    const req = { method: 'POST', originalUrl: url, get: (name) => name === 'origin' ? origin : undefined }
    const res = { status: (value) => { statusCode = value; return res }, json: (value) => { payload = value; return res } }
    requireTrustedBrowserOrigin(req, res, () => { nextCalled = true })
    return { statusCode, payload, nextCalled }
  }

  assert.equal(run({ origin: 'https://attacker.example' }).statusCode, 403)
  assert.equal(run({ url: '/api/stripe/webhook' }).nextCalled, true)
})

test('uploads require real supported file signatures and filenames are path-safe', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43])
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  assert.equal(detectFileType(jpeg), 'image/jpeg')
  assert.equal(fileMatchesAllowedType({ buffer: jpeg, mimetype: 'image/jpeg' }, ['image/jpeg']), true)
  assert.equal(fileMatchesAllowedType({ buffer: svg, mimetype: 'image/png' }, ['image/png']), false)
  assert.equal(safeOriginalName('../../sensitive.pdf'), 'sensitive.pdf')
})

test('administrator access requires MFA on the current server-side session', () => {
  const run = (middleware, user, authSession) => {
    let statusCode
    let nextCalled = false
    const req = { user, authSession }
    const res = { status: (value) => { statusCode = value; return res }, json: () => res }
    middleware(req, res, () => { nextCalled = true })
    return { statusCode, nextCalled }
  }

  const administrator = { isAdmin: true, twoFactor: { enabled: true } }
  const verifiedSession = { mfaVerified: true }
  assert.equal(run(admin, administrator, {}).statusCode, 403)
  assert.equal(run(seller, administrator, {}).statusCode, 403)
  assert.equal(run(seller, { isSeller: true }, {}).nextCalled, true)
  assert.equal(run(admin, { ...administrator, twoFactor: { enabled: false } }, verifiedSession).statusCode, 403)
  assert.equal(run(admin, administrator, verifiedSession).nextCalled, true)
  assert.equal(run(superAdmin, administrator, verifiedSession).statusCode, 403)
  assert.equal(run(superAdmin, { ...administrator, isSuperAdmin: true }, verifiedSession).nextCalled, true)
})

test('access cookies require a token type and expiration', async () => {
  const options = getJwtSigningOptions()
  const tokens = [
    jwt.sign({ id: 'user', sessionId: 'session' }, process.env.JWT_SECRET, { ...options, expiresIn: '1m' }),
    jwt.sign({ id: 'user', sessionId: 'session', type: 'access' }, process.env.JWT_SECRET, options)
  ]
  for (const token of tokens) {
    const req = { cookies: { [ACCESS_COOKIE]: token } }
    const replies = []
    const res = { status: (value) => { replies.push(value); return res }, json: () => res }
    await protect(req, res, () => assert.fail('Incomplete access token was accepted'))
    assert.deepEqual(replies, [401])
  }
})

test('audit records accept review events without losing the security trail', () => {
  const record = new AuditLog({
    actor: '507f191e810c19729de860ea',
    action: 'review_published',
    entityType: 'review',
    entityId: '507f191e810c19729de860eb',
    summary: 'Review published after neutral moderation'
  })
  assert.equal(record.validateSync(), undefined)
})
