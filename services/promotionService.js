const Promotion = require('../models/promotion')

const readPromotionCapacity = (marketCode = 'GB', placement = 'homepage_featured') => {
  const placementKey = placement === 'homepage_video' ? 'VIDEO' : 'SPOTLIGHT'
  const configured = Number.parseInt(
    process.env[`${marketCode}_${placementKey}_CAPACITY`]
      || process.env[`HOMEPAGE_${placementKey}_CAPACITY`],
    10
  )
  return Number.isInteger(configured) && configured >= 1 && configured <= 32 ? configured : 8
}

const releaseExpiredPromotionSlots = async (now = new Date()) => {
  const pendingExpiry = new Date(now.getTime() - 35 * 60 * 1000)
  await Promise.all([
    Promotion.updateMany(
      { status: 'active', endsAt: { $lte: now } },
      { $set: { status: 'expired' }, $unset: { slotNumber: 1 } }
    ),
    Promotion.updateMany(
      { status: 'pending_payment', createdAt: { $lte: pendingExpiry } },
      {
        $set: { status: 'failed', failureReason: 'The promotion payment reservation expired.' },
        $unset: { slotNumber: 1 }
      }
    )
  ])
}

const reserveHomepagePromotion = async (promotionData) => {
  await releaseExpiredPromotionSlots()
  const marketCode = promotionData.marketCode || 'GB'
  const placement = promotionData.placement || 'homepage_featured'
  const capacity = readPromotionCapacity(marketCode, placement)
  const occupiedCount = await Promotion.countDocuments({
    marketCode,
    placement,
    status: { $in: ['pending_payment', 'active'] }
  })
  if (occupiedCount >= capacity) return null

  for (let slotNumber = 1; slotNumber <= capacity; slotNumber += 1) {
    try {
      return await Promotion.create({ ...promotionData, slotNumber })
    } catch (error) {
      if (error?.code !== 11000) throw error
    }
  }
  return null
}

const reserveApprovedPromotion = async (promotionId) => {
  await releaseExpiredPromotionSlots()
  const promotion = await Promotion.findOne({
    _id: promotionId,
    status: 'approved_for_payment',
    creativeReviewStatus: 'approved'
  })
  if (!promotion) return null

  const capacity = readPromotionCapacity(promotion.marketCode, promotion.placement)
  const occupiedCount = await Promotion.countDocuments({
    marketCode: promotion.marketCode,
    placement: promotion.placement,
    status: { $in: ['pending_payment', 'active'] }
  })
  if (occupiedCount >= capacity) return null

  for (let slotNumber = 1; slotNumber <= capacity; slotNumber += 1) {
    try {
      const reserved = await Promotion.findOneAndUpdate(
        { _id: promotion._id, status: 'approved_for_payment', slotNumber: { $exists: false } },
        { $set: { slotNumber, status: 'pending_payment' } },
        { new: true, runValidators: true }
      )
      if (reserved) return reserved
    } catch (error) {
      if (error?.code !== 11000) throw error
    }
  }
  return null
}

module.exports = {
  readPromotionCapacity,
  releaseExpiredPromotionSlots,
  reserveApprovedPromotion,
  reserveHomepagePromotion
}
