const test = require('node:test')
const assert = require('node:assert/strict')
const User = require('../models/user')
const { normalizeGooglePayload } = require('../utils/googleAuth')

test('normalizes a verified Google identity without exposing untrusted avatar URLs', () => {
  const profile = normalizeGooglePayload({
    sub: 'google-subject-123',
    email: 'User@Example.com',
    email_verified: true,
    name: '  Glory   Shopper  ',
    picture: 'https://lh3.googleusercontent.com/avatar'
  })

  assert.deepEqual(profile, {
    subject: 'google-subject-123',
    email: 'user@example.com',
    name: 'Glory Shopper',
    avatar: 'https://lh3.googleusercontent.com/avatar'
  })
})

test('rejects unverified Google emails', () => {
  assert.throws(
    () => normalizeGooglePayload({
      sub: 'google-subject-123',
      email: 'user@example.com',
      email_verified: false
    }),
    /could not verify/
  )
})

test('drops avatar URLs outside Google-owned hosts', () => {
  const profile = normalizeGooglePayload({
    sub: 'google-subject-123',
    email: 'user@example.com',
    email_verified: true,
    picture: 'https://example.com/not-google.png'
  })

  assert.equal(profile.avatar, '')
})

test('Google accounts do not require a local password', () => {
  const user = new User({
    name: 'Google Shopper',
    email: 'google-shopper@example.com',
    googleSubject: 'google-subject-123',
    isEmailVerified: true
  })

  assert.equal(user.validateSync()?.errors?.password, undefined)
})

test('email accounts still require a password', () => {
  const user = new User({
    name: 'Email Shopper',
    email: 'email-shopper@example.com'
  })

  assert.equal(Boolean(user.validateSync()?.errors?.password), true)
})
