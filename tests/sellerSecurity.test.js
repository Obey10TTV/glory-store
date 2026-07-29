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
      stripeAccountId: 'acct_private',
      activationPaymentReference: 'cs_private',
      documents: [{
        type: 'identity',
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
  assert.equal(safe.sellerProfile.documents[0].publicId, undefined)
  assert.equal(safe.sellerProfile.documents[0].resourceType, undefined)
  assert.equal(safe.sellerProfile.documents[0].originalName, 'identity.pdf')
})
