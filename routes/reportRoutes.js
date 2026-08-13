const express = require('express')
const mongoose = require('mongoose')
const ListingReport = require('../models/listingReport')
const Product = require('../models/product')
const AuditLog = require('../models/auditLog')
const { getReportSlaState, scheduleReportReview } = require('../services/trustSafetyService')
const { sendTrustSafetyAlert } = require('../utils/email')
const { logger } = require('../middleware/logger')
const { protect, admin } = require('../middleware/auth')
const {
  reportLimiter,
  moderationLimiter,
  validateListingReport,
  validateReportReview,
  handleValidationErrors
} = require('../middleware/security')

const router = express.Router()

const recordAudit = async (req, fields) => {
  await AuditLog.create({ actor: req.user._id, requestId: req.requestId || '', ...fields })
}

router.post('/listings/:id', protect, reportLimiter, validateListingReport, handleValidationErrors, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Listing not found.' })
    }
    if (req.user.isEmailVerified === false) {
      return res.status(403).json({ message: 'Verify your email before reporting a listing.' })
    }
    const listing = await Product.findOne({ _id: req.params.id, approvalStatus: 'approved' })
    if (!listing?.seller) return res.status(404).json({ message: 'Listing not found.' })
    if (String(listing.seller) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot report your own listing.' })
    }

    const existing = await ListingReport.findOne({ reporter: req.user._id, listing: listing._id })
    if (existing) {
      return res.status(409).json({ message: 'You have already reported this listing. Our team will review it.' })
    }

    const reviewSchedule = scheduleReportReview(req.body.reason)
    const report = await ListingReport.create({
      reporter: req.user._id,
      listing: listing._id,
      seller: listing.seller,
      reason: req.body.reason,
      detail: req.body.detail || '',
      ...reviewSchedule
    })
    await recordAudit(req, {
      action: 'listing_report_created',
      entityType: 'report',
      entityId: report._id.toString(),
      summary: `Confidential report submitted for ${listing._id}`
    })
    if (['critical', 'high'].includes(report.priority)) {
      sendTrustSafetyAlert({
        reportId: report._id.toString(),
        listingId: listing._id.toString(),
        reason: report.reason,
        priority: report.priority,
        triageDueAt: report.triageDueAt
      }).catch(error => logger.error({
        type: 'TRUST_SAFETY_ALERT_FAILED',
        reportId: report._id.toString(),
        message: error.message
      }))
    }
    res.status(201).json({ message: 'Thanks. Your confidential report has been sent to Glory Trust & Safety.' })
  } catch (error) {
    res.status(500).json({ message: 'Unable to submit this report.' })
  }
})

router.get('/mine', protect, async (req, res) => {
  try {
    const reports = await ListingReport.find({ reporter: req.user._id })
      .populate('listing', 'name image category')
      .sort({ createdAt: -1 })
      .limit(100)
    res.json(reports.map(report => ({
      ...report.toJSON(),
      slaState: getReportSlaState(report)
    })))
  } catch (error) {
    res.status(500).json({ message: 'Unable to load your reports.' })
  }
})

router.get('/admin', protect, admin, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim()
    const query = status ? { status } : {}
    const reports = await ListingReport.find(query)
      .select('+adminNote')
      .populate('listing', 'name image brand category approvalStatus')
      .populate('reporter', 'name email')
      .populate('seller', 'name email sellerProfile.storeName sellerProfile.verificationStatus')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(200)
    res.json(reports.map(report => ({
      ...report.toJSON(),
      slaState: getReportSlaState(report)
    })))
  } catch (error) {
    res.status(500).json({ message: 'Unable to load listing reports.' })
  }
})

router.put('/admin/:id', protect, admin, moderationLimiter, validateReportReview, handleValidationErrors, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Report not found.' })
    }
    const report = await ListingReport.findById(req.params.id).select('+adminNote')
    if (!report) return res.status(404).json({ message: 'Report not found.' })

    report.status = req.body.status
    report.adminNote = req.body.adminNote || ''
    if (!report.firstReviewedAt && req.body.status !== 'received') report.firstReviewedAt = new Date()
    report.reviewedAt = ['actioned', 'dismissed'].includes(req.body.status) ? new Date() : undefined
    report.reviewedBy = ['actioned', 'dismissed'].includes(req.body.status) ? req.user._id : undefined

    const listingAction = req.body.listingAction || 'none'
    if (listingAction !== 'none') {
      const listing = await Product.findById(report.listing)
      if (listing) {
        if (listingAction === 'pause') {
          listing.approvalStatus = 'pending'
          listing.rejectionReason = 'Listing paused for a Trust & Safety review.'
          listing.listingEvidence = listing.listingEvidence || {}
          listing.listingEvidence.status = 'needs_more_information'
        }
        if (listingAction === 'remove') {
          listing.approvalStatus = 'rejected'
          listing.rejectionReason = 'Listing removed after a Trust & Safety review.'
          listing.listingEvidence = listing.listingEvidence || {}
          listing.listingEvidence.status = 'rejected'
        }
        listing.reviewedAt = new Date()
        await listing.save()
      }
    }

    await report.save()
    await recordAudit(req, {
      action: `listing_report_${req.body.status}`,
      entityType: 'report',
      entityId: report._id.toString(),
      summary: `Listing report marked ${req.body.status}${listingAction !== 'none' ? `; listing ${listingAction}d` : ''}`
    })
    res.json(report)
  } catch (error) {
    res.status(500).json({ message: 'Unable to update this report.' })
  }
})

module.exports = router
