const crypto = require('crypto')
const Review = require('../models/review')
const Product = require('../models/product')

const normalizeReviewText = (value = '') => String(value)
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ')

const hashReviewText = (value) => crypto
  .createHash('sha256')
  .update(normalizeReviewText(value))
  .digest('hex')

const detectReviewRisk = async ({ comment, conversation, reviewer, seller }) => {
  const signals = []
  const hash = hashReviewText(comment)
  const now = Date.now()
  const accountAgeMs = reviewer.createdAt ? now - new Date(reviewer.createdAt).getTime() : 0
  const confirmationMs = conversation.completedAt
    ? new Date(conversation.completedAt).getTime() - new Date(conversation.createdAt).getTime()
    : Number.MAX_SAFE_INTEGER

  if (accountAgeMs < 7 * 24 * 60 * 60 * 1000) signals.push('new_account')
  if (confirmationMs < 10 * 60 * 1000) signals.push('rapid_confirmation')
  if (/(https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+?\d[\d\s().-]{7,}\d)/i.test(comment)) {
    signals.push('contact_details')
  }

  const [duplicate, pairReviewCount] = await Promise.all([
    Review.exists({ reviewer: reviewer._id, commentHash: hash }),
    Review.countDocuments({ reviewer: reviewer._id, seller, status: { $in: ['pending', 'published'] } })
  ])
  if (duplicate) signals.push('duplicate_text')
  if (pairReviewCount >= 2) signals.push('repeated_buyer_seller_pair')

  return { hash, signals }
}

const recalculateProductRating = async (listingId) => {
  const result = await Review.aggregate([
    { $match: { listing: listingId, status: 'published' } },
    { $group: { _id: '$listing', rating: { $avg: '$rating' }, count: { $sum: 1 } } }
  ])
  const summary = result[0] || { rating: 0, count: 0 }
  await Product.updateOne(
    { _id: listingId },
    { $set: { rating: Number(summary.rating || 0), numReviews: Number(summary.count || 0) } }
  )
  return summary
}

module.exports = {
  detectReviewRisk,
  hashReviewText,
  normalizeReviewText,
  recalculateProductRating
}
