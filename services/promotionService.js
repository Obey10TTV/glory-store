const Promotion = require('../models/promotion')

const readPromotionCapacity = () => {
  const configured = Number.parseInt(process.env.HOMEPAGE_SPOTLIGHT_CAPACITY, 10)
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
  const capacity = readPromotionCapacity()
  const occupiedCount = await Promotion.countDocuments({
    placement: 'homepage_featured',
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

module.exports = {
  readPromotionCapacity,
  releaseExpiredPromotionSlots,
  reserveHomepagePromotion
}
