const test = require('node:test')
const assert = require('node:assert/strict')
const { getEmailTransportConfig } = require('../utils/email')

test('Resend API credentials create the recommended secure SMTP transport', () => {
  const config = getEmailTransportConfig({
    RESEND_API_KEY: 're_test_placeholder',
    EMAIL_FROM: 'Glory <accounts@glory.example>'
  })

  assert.equal(config.provider, 'resend')
  assert.equal(config.from, 'Glory <accounts@glory.example>')
  assert.equal(config.transport.host, 'smtp.resend.com')
  assert.equal(config.transport.port, 465)
  assert.equal(config.transport.secure, true)
  assert.equal(config.transport.auth.user, 'resend')
  assert.equal(config.transport.auth.pass, 're_test_placeholder')
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
