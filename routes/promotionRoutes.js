const express = require('express')
const Promotion = require('../models/promotion')
const { protect, seller } = require('../middleware/auth')
const { getPromotionPlans } = require('../services/marketplaceService')

const router = express.Router()

const expireDuePromotions = async () => {
  await Promotion.updateMany(
    { status: 'active', endsAt: { $lte: new Date() } },
    { $set: { status: 'expired' } }
  )
}

const publicPlan = (plan) => ({
  code: plan.code,
  placement: plan.placement,
  label: plan.label,
  description: plan.description,
  feePence: plan.feePence,
  currency: plan.currency,
  durationDays: plan.durationDays
})

router.get('/plans', (req, res) => {
  res.json({ items: getPromotionPlans().map(publicPlan) })
})

router.get('/homepage', async (req, res) => {
  try {
    await expireDuePromotions()
    const now = new Date()
    const promotions = await Promotion.find({
      placement: 'homepage_featured',
      status: 'active',
      startsAt: { $lte: now },
      endsAt: { $gt: now }
    })
      .sort({ activatedAt: -1, _id: -1 })
      .limit(8)
      .populate({
        path: 'listing',
        match: { approvalStatus: 'approved', countInStock: { $gt: 0 } },
        select: 'name price compareAtPrice category image images brand rating numReviews countInStock seller approvalStatus',
        populate: {
          path: 'seller',
          select: 'name sellerProfile.storeName sellerProfile.verificationStatus'
        }
      })
      .lean()

    const items = promotions
      .filter((promotion) => promotion.listing)
      .map((promotion) => ({
        id: promotion._id,
        placement: promotion.placement,
        label: 'Sponsored',
        endsAt: promotion.endsAt,
        listing: promotion.listing
      }))

    res.json({ items })
  } catch (error) {
    res.status(500).json({ message: 'Unable to load sponsored listings.' })
  }
})

router.get('/mine', protect, seller, async (req, res) => {
  try {
    await expireDuePromotions()
    const promotions = await Promotion.find({ seller: req.user._id })
      .populate('listing', 'name image brand category approvalStatus')
      .sort({ createdAt: -1 })
      .limit(50)
    res.json(promotions)
  } catch (error) {
    res.status(500).json({ message: 'Unable to load your promotions.' })
  }
})

module.exports = router
