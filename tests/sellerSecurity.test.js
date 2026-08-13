const test = require('node:test')
const assert = require('node:assert/strict')
const User = require('../models/user')

test('seller JSON never exposes payout, activation or private document storage references', () => {
  const user = new User({
    name: 'Seller Example',
    email: 'seller@example.com',
    password: 'not-saved',
    isSeller: true,
    sellerProfile: {
      storeName: 'Private Beauty',
      brandName: 'Private Beauty',
      returnPolicy: 'returns_accepted',
      returnPolicyDetail: '14-day unopened return policy',
      responseTimeCommitment: 'within_24_hours',
      stripeAccountId: 'acct_private',
      activationPaymentReference: 'cs_private',
      billingCustomerId: 'cus_private',
      billingSubscriptionId: 'sub_private',
      identityVerification: {
        provider: 'stripe_identity',
        status: 'verified',
        sessionId: 'vs_private',
        lastErrorCode: 'private_error'
      },
      documents: [{
        type: 'identity',
        kind: 'passport',
        publicId: 'private/cloudinary/reference',
        resourceType: 'raw',
        originalName: 'identity.pdf'
      }]
    }
  })

  const safe = user.toJSON()
  assert.equal(safe.password, undefined)
  assert.equal(safe.sellerProfile.stripeAccountId, undefined)
  assert.equal(safe.sellerProfile.activationPaymentReference, undefined)
  assert.equal(safe.sellerProfile.billingCustomerId, undefined)
  assert.equal(safe.sellerProfile.billingSubscriptionId, undefined)
  assert.equal(safe.sellerProfile.identityVerification.sessionId, undefined)
  assert.equal(safe.sellerProfile.identityVerification.lastErrorCode, undefined)
  assert.equal(safe.sellerProfile.identityVerification.status, 'verified')
  assert.equal(safe.sellerProfile.documents[0].publicId, undefined)
  assert.equal(safe.sellerProfile.documents[0].resourceType, undefined)
  assert.equal(safe.sellerProfile.documents[0].originalName, 'identity.pdf')
  assert.equal(safe.sellerProfile.documents[0].kind, 'passport')
  assert.equal(safe.sellerProfile.brandName, 'Private Beauty')
  assert.equal(safe.sellerProfile.returnPolicy, 'returns_accepted')
})
