const test = require('node:test')
const assert = require('node:assert/strict')
const Conversation = require('../models/conversation')
const Review = require('../models/review')
const { hashReviewText, normalizeReviewText } = require('../services/reviewService')

test('review text normalization catches cosmetic duplicate formatting', () => {
  assert.equal(normalizeReviewText('  Lovely   Seller\nAnd product  '), 'lovely seller and product')
  assert.equal(hashReviewText('Lovely seller and product'), hashReviewText(' lovely   seller AND product '))
})

test('conversation records mutual transaction confirmation separately', () => {
  const conversation = new Conversation({
    listing: '65b4b77696529734830f1101',
    buyer: '65b4b77696529734830f1102',
    seller: '65b4b77696529734830f1103',
    transactionStatus: 'buyer_confirmed',
    buyerConfirmedAt: new Date()
  })
  assert.equal(conversation.transactionStatus, 'buyer_confirmed')
  assert.ok(conversation.buyerConfirmedAt)
  assert.equal(conversation.sellerConfirmedAt, undefined)
})

test('public review JSON omits moderation and detection internals', () => {
  const review = new Review({
    listing: '65b4b77696529734830f1101',
    conversation: '65b4b77696529734830f1102',
    reviewer: '65b4b77696529734830f1103',
    seller: '65b4b77696529734830f1104',
    reviewerName: 'A Buyer',
    rating: 2,
    comment: 'The item differed from the listing photos.',
    commentHash: 'private-hash',
    riskSignals: ['new_account'],
    moderationNote: 'private note'
  })
  const safe = review.toJSON()
  assert.equal(safe.verifiedInteraction, true)
  assert.equal(safe.commentHash, undefined)
  assert.equal(safe.riskSignals, undefined)
  assert.equal(safe.moderationNote, undefined)
})
