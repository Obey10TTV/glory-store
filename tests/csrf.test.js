const test = require('node:test')
const assert = require('node:assert/strict')
const { csrfProtection } = require('../middleware/csrf')
const { CSRF_COOKIE } = require('../utils/authSession')

const run = ({ method = 'POST', cookie, header, url = '/api/orders' }) => {
  let statusCode
  let payload
  let nextCalled = false
  const req = {
    method,
    originalUrl: url,
    cookies: cookie ? { [CSRF_COOKIE]: cookie } : {},
    get: (name) => name === 'x-csrf-token' ? header : undefined
  }
  const res = {
    status: (status) => { statusCode = status; return res },
    json: (body) => { payload = body; return res }
  }
  csrfProtection(req, res, () => { nextCalled = true })
  return { statusCode, payload, nextCalled }
}

test('CSRF middleware allows safe methods and webhook signatures', () => {
  assert.equal(run({ method: 'GET' }).nextCalled, true)
  assert.equal(run({ url: '/api/paystack/webhook' }).nextCalled, true)
})

test('CSRF middleware requires matching double-submit tokens', () => {
  assert.equal(run({ cookie: 'secure-value', header: 'secure-value' }).nextCalled, true)
  const rejected = run({ cookie: 'secure-value', header: 'wrong-value' })
  assert.equal(rejected.statusCode, 403)
  assert.match(rejected.payload.message, /Security token/)
})
