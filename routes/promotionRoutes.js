const express = require('express')
const Promotion = require('../models/promotion')
const Product = require('../models/product')
const AuditLog = require('../models/auditLog')
const { protect, seller, verifiedSeller } = require('../middleware/auth')
const { validatePromotionCheckout, handleValidationErrors } = require('../middleware/security')
const {
  getPromotionPlan,
  getPromotionPlans,
  normalizeMarketCode,
  pricePromotionForSeller
} = require('../services/marketplaceService')
const { releaseExpiredPromotionSlots } = require('../services/promotionService')

const router = express.Router()

const publicPlan = (plan) => ({
  code: plan.code,
  placement: plan.placement,
  label: plan.label,
  description: plan.description,
  feeMinor: plan.feeMinor,
  feePence: plan.feePence,
  currency: plan.currency,
  marketCode: plan.marketCode,
  billingProvider: plan.billingProvider,
  durationDays: plan.durationDays,
  requiresCreative: plan.requiresCreative
})

router.get('/plans', (req, res) => {
  const marketCode = normalizeMarketCode(req.query.market, 'NG')
  res.json({ marketCode, items: getPromotionPlans(marketCode).map(publicPlan) })
})

router.get('/homepage', async (req, res) => {
  try {
    await releaseExpiredPromotionSlots()
    const now = new Date()
    const marketCode = normalizeMarketCode(req.query.market, 'NG')
    const promotions = await Promotion.find({
      marketCode,
      placement: { $in: ['homepage_featured', 'homepage_video'] },
      status: 'active',
      startsAt: { $lte: now },
      endsAt: { $gt: now },
      $or: [
        { placement: 'homepage_featured' },
        { placement: 'homepage_video', creativeReviewStatus: 'approved' }
      ]
    })
      .sort({ activatedAt: -1, _id: -1 })
      .limit(8)
      .populate({
        path: 'listing',
        match: { approvalStatus: 'approved', planVisibilityStatus: { $ne: 'paused' }, countInStock: { $gt: 0 } },
        select: 'name price compareAtPrice currency marketCode category image images brand rating numReviews countInStock seller approvalStatus',
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
        creative: promotion.placement === 'homepage_video' ? {
          type: 'video',
          headline: promotion.creativeHeadline,
          copy: promotion.creativeCopy,
          mediaUrl: promotion.creativeMediaUrl,
          ctaLabel: promotion.creativeCtaLabel
        } : null,
        listing: promotion.listing
      }))

    res.json({
      marketCode,
      items,
      listingItems: items.filter((item) => item.placement === 'homepage_featured'),
      videoItems: items.filter((item) => item.placement === 'homepage_video')
    })
  } catch (error) {
    res.status(500).json({ message: 'Unable to load sponsored listings.' })
  }
})

router.get('/mine', protect, seller, async (req, res) => {
  try {
    await releaseExpiredPromotionSlots()
    const promotions = await Promotion.find({ seller: req.user._id })
      .populate('listing', 'name image brand category approvalStatus')
      .sort({ createdAt: -1 })
      .limit(50)
    const items = promotions.map((promotion) => {
      const sellerFeedback = promotion.creativeReviewStatus === 'rejected'
        ? promotion.creativeReviewNote
        : (['failed', 'cancelled'].includes(promotion.status) ? promotion.failureReason : '')
      return {
        ...promotion.toJSON(),
        sellerFeedback: sellerFeedback || ''
      }
    })
    res.json(items)
  } catch (error) {
    res.status(500).json({ message: 'Unable to load your promotions.' })
  }
})

router.post('/video-drafts', protect, verifiedSeller, validatePromotionCheckout, handleValidationErrors, async (req, res) => {
  try {
    const marketCode = normalizeMarketCode(req.user.sellerProfile?.marketCode, 'GB')
    const plan = getPromotionPlan(req.body.planCode, marketCode)
    if (!plan || plan.placement !== 'homepage_video') {
      return res.status(400).json({ message: 'Choose an available homepage video plan.' })
    }

    const headline = String(req.body.creativeHeadline || '').trim()
    const creativeCopy = String(req.body.creativeCopy || '').trim()
    if (headline.length < 4 || creativeCopy.length < 12) {
      return res.status(400).json({ message: 'Add a clear campaign headline and description before review.' })
    }

    const mediaUrl = String(req.body.creativeMediaUrl || '').trim()
    let mediaHost = ''
    try {
      mediaHost = new URL(mediaUrl).hostname
    } catch (error) {
      return res.status(400).json({ message: 'Upload the campaign video through Glory first.' })
    }
    if (mediaHost !== 'res.cloudinary.com') {
      return res.status(400).json({ message: 'Upload the campaign video through Glory first.' })
    }

    const listing = await Product.findOne({
      _id: req.body.listingId,
      seller: req.user._id,
      marketCode,
      approvalStatus: 'approved',
      planVisibilityStatus: { $ne: 'paused' },
      countInStock: { $gt: 0 }
    })
    if (!listing) {
      return res.status(404).json({ message: 'Choose an approved, in-stock listing from this market.' })
    }

    const existing = await Promotion.findOne({
      seller: req.user._id,
      listing: listing._id,
      placement: 'homepage_video',
      status: { $in: ['pending_review', 'approved_for_payment', 'pending_payment', 'active'] }
    })
    if (existing) {
      return res.status(409).json({ message: 'This listing already has a video campaign in review or in progress.' })
    }

    const price = pricePromotionForSeller(plan, req.user.sellerProfile)
    const promotion = await Promotion.create({
      seller: req.user._id,
      listing: listing._id,
      marketCode,
      placement: plan.placement,
      planCode: plan.code,
      label: plan.label,
      baseAmountPence: price.baseFeeMinor,
      discountPence: price.discountMinor,
      amountPence: price.feeMinor,
      sellerPlanCode: price.sellerPlanCode,
      currency: plan.currency,
      durationDays: plan.durationDays,
      paymentProvider: plan.billingProvider,
      creativeType: 'video',
      creativeHeadline: headline,
      creativeCopy,
      creativeMediaUrl: mediaUrl,
      creativeCtaLabel: String(req.body.creativeCtaLabel || 'View product').trim(),
      creativeReviewStatus: 'pending',
      status: 'pending_review'
    })

    await AuditLog.create({
      actor: req.user._id,
      action: 'homepage_video_submitted',
      entityType: 'promotion',
      entityId: promotion._id.toString(),
      summary: `Homepage video submitted for listing ${listing._id}`,
      requestId: req.requestId || ''
    })
    res.status(201).json({
      message: 'Your video campaign is in review. Payment is requested only after approval.',
      promotion
    })
  } catch (error) {
    res.status(500).json({ message: 'The video campaign could not be submitted.' })
  }
})

module.exports = router
