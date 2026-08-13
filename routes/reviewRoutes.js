const express = require('express')
const mongoose = require('mongoose')
const Review = require('../models/review')
const ReviewReport = require('../models/reviewReport')
const Conversation = require('../models/conversation')
const Product = require('../models/product')
const AuditLog = require('../models/auditLog')
const { protect, admin } = require('../middleware/auth')
const { moderationLimiter, reportLimiter } = require('../middleware/security')
const { detectReviewRisk, recalculateProductRating } = require('../services/reviewService')

const router = express.Router()

const publicReviewFields = 'reviewerName rating comment verifiedInteraction publishedAt createdAt'

const recordAudit = async (req, fields) => {
  await AuditLog.create({ actor: req.user._id, requestId: req.requestId || '', ...fields })
}

router.get('/admin', protect, admin, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim()
    const query = status ? { status } : {}
    const reviews = await Review.find(query)
      .select('+riskSignals +moderationNote')
      .populate('listing', 'name image brand category')
      .populate('reviewer', 'name email createdAt')
      .populate('seller', 'name email sellerProfile.storeName')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(250)
      .lean()
    const reports = await ReviewReport.find({ review: { $in: reviews.map(review => review._id) } })
      .populate('reporter', 'name email')
      .sort({ createdAt: -1 })
      .lean()
    const reportsByReview = reports.reduce((result, report) => {
      const key = String(report.review)
      result[key] = [...(result[key] || []), report]
      return result
    }, {})
    res.json(reviews.map(review => ({ ...review, reports: reportsByReview[String(review._id)] || [] })))
  } catch (error) {
    res.status(500).json({ message: 'Unable to load the review moderation queue.' })
  }
})

router.put('/admin/:id', protect, admin, moderationLimiter, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Review not found.' })
    const status = String(req.body.status || '').trim()
    if (!['published', 'rejected', 'removed'].includes(status)) {
      return res.status(400).json({ message: 'Choose a valid review decision.' })
    }
    const moderationNote = String(req.body.moderationNote || '').trim()
    if (moderationNote.length > 1000) return res.status(400).json({ message: 'Moderation note is too long.' })

    const review = await Review.findById(req.params.id).select('+moderationNote')
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    review.status = status
    review.moderationNote = moderationNote
    review.reviewedAt = new Date()
    review.reviewedBy = req.user._id
    review.publishedAt = status === 'published' ? (review.publishedAt || new Date()) : undefined
    await review.save()

    if (req.body.reportDecision && ['actioned', 'dismissed'].includes(req.body.reportDecision)) {
      await ReviewReport.updateMany(
        { review: review._id, status: 'received' },
        { $set: { status: req.body.reportDecision, reviewedAt: new Date(), reviewedBy: req.user._id } }
      )
    }
    await recalculateProductRating(review.listing)
    await recordAudit(req, {
      action: `review_${status}`,
      entityType: 'review',
      entityId: review._id.toString(),
      summary: `Verified-interaction review marked ${status}`
    })
    res.json({ message: `Review ${status}.` })
  } catch (error) {
    res.status(500).json({ message: 'Unable to update this review.' })
  }
})

router.post('/:reviewId/report', protect, reportLimiter, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.reviewId)) return res.status(404).json({ message: 'Review not found.' })
    if (req.user.isEmailVerified === false) return res.status(403).json({ message: 'Verify your email before reporting a review.' })
    const reason = String(req.body.reason || '').trim()
    const allowedReasons = ['suspected_fake', 'conflict_of_interest', 'abusive', 'personal_information', 'irrelevant', 'other']
    if (!allowedReasons.includes(reason)) return res.status(400).json({ message: 'Choose a valid report reason.' })
    const detail = String(req.body.detail || '').trim()
    if (detail.length > 1000 || (reason === 'other' && detail.length < 10)) {
      return res.status(400).json({ message: 'Add a short explanation of the concern.' })
    }

    const review = await Review.findOne({ _id: req.params.reviewId, status: 'published' })
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    if (String(review.reviewer) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot report your own review.' })
    }
    const existing = await ReviewReport.exists({ reporter: req.user._id, review: review._id })
    if (existing) return res.status(409).json({ message: 'You have already reported this review.' })

    await ReviewReport.create({ reporter: req.user._id, review: review._id, reason, detail })
    review.reportCount += 1
    review.lastReportedAt = new Date()
    await review.save()
    await recordAudit(req, {
      action: 'review_report_created',
      entityType: 'review',
      entityId: review._id.toString(),
      summary: 'Confidential review report submitted'
    })
    res.status(201).json({ message: 'Thanks. Glory will review this feedback report.' })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'You have already reported this review.' })
    res.status(500).json({ message: 'Unable to report this review.' })
  }
})

router.post('/:productId', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId) || !mongoose.isValidObjectId(req.body.conversationId)) {
      return res.status(400).json({ message: 'Choose a valid confirmed interaction.' })
    }
    if (req.user.isEmailVerified === false) return res.status(403).json({ message: 'Verify your email before leaving a review.' })
    const rating = Number(req.body.rating)
    const comment = String(req.body.comment || '').trim()
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be a whole number between 1 and 5.' })
    }
    if (comment.length < 10 || comment.length > 1000) {
      return res.status(400).json({ message: 'Review must be between 10 and 1000 characters.' })
    }

    const [product, conversation] = await Promise.all([
      Product.findById(req.params.productId),
      Conversation.findById(req.body.conversationId)
    ])
    if (!product || !conversation || String(conversation.listing) !== String(product._id)) {
      return res.status(404).json({ message: 'Confirmed interaction not found for this listing.' })
    }
    if (String(conversation.buyer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the buyer in this interaction can leave a review.' })
    }
    if (conversation.transactionStatus !== 'confirmed' || !conversation.completedAt) {
      return res.status(403).json({ message: 'Both buyer and seller must confirm the transaction before feedback is accepted.' })
    }
    if (String(conversation.seller) !== String(product.seller)) {
      return res.status(409).json({ message: 'The listing seller no longer matches this interaction.' })
    }
    if (await Review.exists({ conversation: conversation._id, reviewer: req.user._id })) {
      return res.status(409).json({ message: 'You have already reviewed this interaction.' })
    }

    const risk = await detectReviewRisk({
      comment,
      conversation,
      reviewer: req.user,
      seller: conversation.seller
    })
    const review = await Review.create({
      listing: product._id,
      conversation: conversation._id,
      reviewer: req.user._id,
      seller: conversation.seller,
      reviewerName: req.user.name,
      rating,
      comment,
      commentHash: risk.hash,
      riskSignals: risk.signals,
      status: 'pending',
      verifiedInteraction: true
    })
    conversation.review = review._id
    await conversation.save()
    await recordAudit(req, {
      action: 'verified_interaction_review_submitted',
      entityType: 'review',
      entityId: review._id.toString(),
      summary: 'Review submitted to the neutral moderation queue'
    })
    res.status(201).json({ message: 'Your review is in moderation. Positive and negative reviews receive the same checks.' })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'You have already reviewed this interaction.' })
    res.status(500).json({ message: 'Unable to submit this review.' })
  }
})

router.get('/:productId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) return res.status(404).json({ message: 'Product not found.' })
    const exists = await Product.exists({ _id: req.params.productId })
    if (!exists) return res.status(404).json({ message: 'Product not found.' })
    const reviews = await Review.find({ listing: req.params.productId, status: 'published' })
      .select(publicReviewFields)
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(100)
    res.json(reviews)
  } catch (error) {
    res.status(500).json({ message: 'Unable to load reviews.' })
  }
})

router.delete('/:reviewId', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.reviewId)) return res.status(404).json({ message: 'Review not found.' })
    const review = await Review.findById(req.params.reviewId)
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    if (String(review.reviewer) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the review author can withdraw this review.' })
    }
    review.status = 'removed'
    review.reviewedAt = new Date()
    review.publishedAt = undefined
    await review.save()
    await recalculateProductRating(review.listing)
    res.json({ message: 'Review withdrawn.' })
  } catch (error) {
    res.status(500).json({ message: 'Unable to withdraw this review.' })
  }
})

module.exports = router
