const express = require('express')
const { protect } = require('../middleware/auth')
const {
  skinGuideLimiter,
  validateSkinGuideMessage,
  handleValidationErrors
} = require('../middleware/security')
const { recordAudit } = require('../utils/audit')
const { consumeSkinGuideQuota, getSkinGuideUsage } = require('../services/skinGuideQuotaService')

const router = express.Router()

const cleanPhone = (value = '') => String(value).replace(/\D/g, '')
const getClinicianUrl = () => {
  const phone = cleanPhone(process.env.SKIN_GUIDE_WHATSAPP_PHONE)
  if (!/^\d{7,15}$/.test(phone)) return ''
  const message = encodeURIComponent('Hello, I would like skincare guidance through Glory.')
  return `https://wa.me/${phone}?text=${message}`
}

const skinGuideEnabled = () => process.env.SKIN_GUIDE_ENABLED === 'true'

const requireVerifiedMember = (req, res, next) => {
  if (req.user?.isEmailVerified === false) {
    return res.status(403).json({ message: 'Verify your email before using Skin Guide.' })
  }
  return next()
}

router.get('/status', protect, requireVerifiedMember, async (req, res) => {
  try {
    const usage = await getSkinGuideUsage(req.user._id)
    res.json({
      name: 'Glory Skin Guide',
      available: skinGuideEnabled(),
      clinicianAvailable: Boolean(getClinicianUrl()),
      usage: {
        messagesRemaining: Math.max(0, usage.limits.dailyMessages - usage.messagesUsed),
        photosRemaining: Math.max(0, usage.limits.dailyImages - usage.imagesUsed),
        handoffsRemaining: Math.max(0, usage.limits.dailyHandoffs - usage.handoffsUsed)
      }
    })
  } catch (error) {
    res.status(503).json({ message: 'Skin Guide is unavailable right now.' })
  }
})

router.post('/messages', protect, requireVerifiedMember, skinGuideLimiter, validateSkinGuideMessage, handleValidationErrors, async (req, res) => {
  // The provider adapter deliberately remains disabled until an approved paid
  // account and medical-safety review are in place. No message content is logged.
  if (!skinGuideEnabled()) {
    return res.status(503).json({
      message: 'Glory Skin Guide is being prepared and is not accepting questions yet.'
    })
  }

  try {
    const quota = await consumeSkinGuideQuota({ userId: req.user._id, kind: 'message' })
    if (!quota.allowed) {
      return res.status(429).json({
        message: quota.reason === 'global_limit'
          ? 'Skin Guide has reached today\'s safe-use limit. Please return tomorrow.'
          : 'You have reached today\'s Skin Guide allowance. Please return tomorrow.'
      })
    }

    await recordAudit(req, {
      action: 'skin_guide_message_requested',
      entityType: 'skin_guide',
      entityId: String(req.user._id),
      summary: 'Skin Guide request accepted without retaining message content.'
    })

    res.status(503).json({
      message: 'Glory Skin Guide is not live yet. Your daily allowance is protected while we finish the reviewed provider setup.',
      remaining: quota.remaining
    })
  } catch (error) {
    res.status(503).json({ message: 'Skin Guide is unavailable right now.' })
  }
})

router.post('/clinician-handoff', protect, requireVerifiedMember, skinGuideLimiter, async (req, res) => {
  const url = getClinicianUrl()
  if (!url) return res.status(503).json({ message: 'Clinician chat is not available yet.' })

  try {
    const quota = await consumeSkinGuideQuota({ userId: req.user._id, kind: 'handoff' })
    if (!quota.allowed) {
      return res.status(429).json({ message: 'You have reached today\'s clinician-chat allowance. Please return tomorrow.' })
    }

    await recordAudit(req, {
      action: 'skin_guide_clinician_handoff',
      entityType: 'skin_guide',
      entityId: String(req.user._id),
      summary: 'Skin Guide clinician hand-off opened without retaining chat content.'
    })

    res.json({ url, remaining: quota.remaining })
  } catch (error) {
    res.status(503).json({ message: 'Clinician chat is unavailable right now.' })
  }
})

module.exports = router
