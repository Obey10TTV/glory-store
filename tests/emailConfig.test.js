const test = require('node:test')
const assert = require('node:assert/strict')
const { getEmailTransportConfig, sendOtpEmail } = require('../utils/email')

test('Resend API credentials take precedence over SMTP', () => {
  const config = getEmailTransportConfig({
    RESEND_API_KEY: 're_test_placeholder',
    EMAIL_FROM: 'Glory <accounts@glory.example>'
  })

  assert.equal(config.provider, 'resend')
  assert.equal(config.from, 'Glory <accounts@glory.example>')
  assert.equal(config.apiKey, 're_test_placeholder')
  assert.equal(config.transport, undefined)
})

test('verification codes are delivered through Resend HTTPS and provider errors are sanitized', async (t) => {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  t.after(() => {
    if (apiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = apiKey
    if (from === undefined) delete process.env.EMAIL_FROM
    else process.env.EMAIL_FROM = from
  })
  process.env.RESEND_API_KEY = 're_test_placeholder'
  process.env.EMAIL_FROM = 'Glory <accounts@glory.example>'
  const email = { to: 'buyer@example.test', code: '123456' }
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }))
  await sendOtpEmail(email)
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, 'https://api.resend.com/emails')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer re_test_placeholder')
  const payload = JSON.parse(options.body)
  assert.equal(payload.from, process.env.EMAIL_FROM)
  assert.deepEqual(payload.to, [email.to])
  assert.match(payload.text, /123456/)

  request.mock.mockImplementation(async () => new Response('sensitive provider details', { status: 403 }))
  await assert.rejects(sendOtpEmail(email), { message: 'Resend email request failed (HTTP 403)' })
})

test('generic SMTP remains available as a fallback', () => {
  const config = getEmailTransportConfig({
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'Glory <accounts@example.test>'
  })

  assert.equal(config.provider, 'smtp')
  assert.equal(config.from, 'Glory <accounts@example.test>')
  assert.equal(config.transport.port, 587)
  assert.equal(config.transport.secure, false)
})

test('email delivery stays unconfigured without complete credentials', () => {
  assert.equal(getEmailTransportConfig({}), null)
  assert.equal(getEmailTransportConfig({ RESEND_API_KEY: 're_test_placeholder' }).from, '')
  assert.equal(getEmailTransportConfig({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587' }), null)
})
