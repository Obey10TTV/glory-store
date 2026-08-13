const Product = require('../models/product')
const User = require('../models/user')
const { getEffectiveSellerPlan } = require('./marketplaceService')

const enforceSellerPlanVisibility = async (sellerId) => {
  const user = await User.findById(sellerId).select(
    'isAdmin isSeller sellerProfile.membershipPlanCode sellerProfile.membershipStatus'
  )
  if (!user?.isSeller || user.isAdmin) return null

  const plan = getEffectiveSellerPlan(user.sellerProfile)
  const listings = await Product.find({
    seller: user._id,
    approvalStatus: { $ne: 'rejected' }
  })
    .select('_id planVisibilityStatus createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean()

  const visibleIds = listings.slice(0, plan.activeListingLimit).map(listing => listing._id)
  const pausedIds = listings.slice(plan.activeListingLimit).map(listing => listing._id)
  const operations = []
  if (visibleIds.length) {
    operations.push(Product.updateMany(
      { _id: { $in: visibleIds } },
      { $set: { planVisibilityStatus: 'visible' } }
    ))
  }
  if (pausedIds.length) {
    operations.push(Product.updateMany(
      { _id: { $in: pausedIds } },
      { $set: { planVisibilityStatus: 'paused' } }
    ))
  }
  await Promise.all(operations)

  return {
    planCode: plan.code,
    activeListingLimit: plan.activeListingLimit,
    visibleCount: visibleIds.length,
    pausedCount: pausedIds.length
  }
}

module.exports = { enforceSellerPlanVisibility }
