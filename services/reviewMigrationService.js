const Review = require('../models/review')
const Product = require('../models/product')
const SystemMigration = require('../models/systemMigration')

const REVIEW_INTEGRITY_MIGRATION = 'verified-interaction-reviews-v1'

const migrateLegacyProductReviews = async () => {
  if (await SystemMigration.exists({ key: REVIEW_INTEGRITY_MIGRATION })) return false

  const publishedRatings = await Review.aggregate([
    { $match: { status: 'published' } },
    { $group: { _id: '$listing', rating: { $avg: '$rating' }, count: { $sum: 1 } } }
  ])

  await Product.updateMany(
    {},
    { $unset: { reviews: 1 }, $set: { rating: 0, numReviews: 0 } }
  )

  if (publishedRatings.length) {
    await Product.bulkWrite(publishedRatings.map(summary => ({
      updateOne: {
        filter: { _id: summary._id },
        update: { $set: { rating: Number(summary.rating || 0), numReviews: Number(summary.count || 0) } }
      }
    })))
  }

  try {
    await SystemMigration.create({
      key: REVIEW_INTEGRITY_MIGRATION,
      details: `Removed legacy embedded reviews and reconciled ${publishedRatings.length} rated listings.`
    })
  } catch (error) {
    if (error?.code !== 11000) throw error
  }
  return true
}

module.exports = { migrateLegacyProductReviews, REVIEW_INTEGRITY_MIGRATION }
