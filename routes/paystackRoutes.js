const crypto = require('crypto')
const express = require('express')
const https = require('https')
const router = express.Router()
const { protect, seller, verifiedSeller } = require('../middleware/auth')
const Order = require('../models/order')
const User = require('../models/user')
const Product = require('../models/product')
const Promotion = require('../models/promotion')
const AuditLog = require('../models/auditLog')
const { markOrderPaid } = require('../services/orderService')
const {
  getMarketplaceConfig,
  getPromotionPlan,
  getSellerPlan,
  normalizeMarketCode,
  pricePromotionForSeller
} = require('../services/marketplaceService')
const { reserveApprovedPromotion, reserveHomepagePromotion } = require('../services/promotionService')
const { enforceSellerPlanVisibility } = require('../services/sellerPlanEnforcementService')
const { validatePromotionCheckout, handleValidationErrors } = require('../middleware/security')
const { sendOrderStatusEmail } = require('../utils/email')
const { logger } = require('../middleware/logger')

const configuredClientOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL
].filter(Boolean)

const getClientOrigin = () => configuredClientOrigins[0]
  || (process.env.NODE_ENV === 'production' ? 'https://glory-ca.vercel.app' : 'http://localhost:3000')

const paystackRequest = ({ path, method = 'GET', body }) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null
  const request = https.request({
    hostname: 'api.paystack.co',
    port: 443,
    path,
    method,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
    }
  }, (response) => {
    let data = ''
    response.on('data', (chunk) => { data += chunk })
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data)
        if (response.statusCode >= 400) {
          return reject(Object.assign(new Error(parsed.message || 'Payment provider rejected the request'), { statusCode: 502 }))
        }
        resolve(parsed)
      } catch (error) {
        reject(Object.assign(new Error('Invalid payment provider response'), { statusCode: 502 }))
      }
    })
  })
  request.on('error', reject)
  if (payload) request.write(payload)
  request.end()
})

const canAccessOrder = (order, user) => {
  const buyerId = order.buyer?._id || order.buyer
  return user.isAdmin || buyerId?.toString() === user._id.toString()
}

const normalizeMetadata = (metadata) => {
  if (metadata && typeof metadata === 'object') return metadata
  if (typeof metadata !== 'string') return {}
  try {
    const parsed = JSON.parse(metadata)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    return {}
  }
}

const applySellerPlanPayment = async (paymentData) => {
  if (paymentData?.status !== 'success') return null
  const metadata = normalizeMetadata(paymentData.metadata)
  if (metadata.purpose !== 'seller_plan') return null
  const marketCode = normalizeMarketCode(metadata.marketCode, 'NG')
  const plan = getSellerPlan(metadata.planCode, marketCode)
  if (!metadata.userId || !plan || plan.code === 'starter') {
    throw Object.assign(new Error('Seller plan payment metadata is incomplete'), { statusCode: 400 })
  }
  if (
    String(paymentData.currency || '').toUpperCase() !== plan.currency
    || Number(paymentData.amount) !== Number(plan.feeMinor)
  ) {
    throw Object.assign(new Error('Seller plan amount or currency does not match'), { statusCode: 400 })
  }

  const user = await User.findById(metadata.userId).select('+sellerProfile.membershipPaymentReference')
  if (!user?.isSeller) throw Object.assign(new Error('Seller account not found'), { statusCode: 404 })
  if (normalizeMarketCode(user.sellerProfile.marketCode, 'GB') !== marketCode) {
    throw Object.assign(new Error('Seller plan market does not match this store'), { statusCode: 409 })
  }
  if (
    user.sellerProfile.membershipStatus === 'active'
    && user.sellerProfile.membershipPaymentReference === paymentData.reference
  ) return user

  const now = new Date()
  user.sellerProfile.membershipPlanCode = plan.code
  user.sellerProfile.membershipStatus = 'active'
  user.sellerProfile.membershipCurrentPeriodEnd = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000))
  user.sellerProfile.membershipCancelAtPeriodEnd = true
  user.sellerProfile.membershipProvider = 'paystack'
  user.sellerProfile.membershipCurrency = plan.currency
  user.sellerProfile.membershipPaymentReference = String(paymentData.reference || '')
  await user.save()
  await enforceSellerPlanVisibility(user._id)
  await AuditLog.create({
    actor: user._id,
    action: 'seller_plan_activated',
    entityType: 'seller_subscription',
    entityId: user._id.toString(),
    summary: `${plan.label} seller plan activated for 30 days through Paystack`
  })
  return user
}

const applyHomepagePromotionPayment = async (paymentData) => {
  if (paymentData?.status !== 'success') return null
  const metadata = normalizeMetadata(paymentData.metadata)
  if (metadata.purpose !== 'homepage_promotion') return null
  if (!metadata.promotionId || !metadata.userId) {
    throw Object.assign(new Error('Promotion payment metadata is incomplete'), { statusCode: 400 })
  }

  const promotion = await Promotion.findById(metadata.promotionId).select('+paymentReference')
  if (!promotion || String(promotion.seller) !== String(metadata.userId)) {
    throw Object.assign(new Error('Promotion not found'), { statusCode: 404 })
  }
  if (promotion.status === 'active') return promotion
  if (
    String(paymentData.currency || '').toUpperCase() !== promotion.currency
    || Number(paymentData.amount) !== Number(promotion.amountPence)
    || metadata.planCode !== promotion.planCode
  ) {
    throw Object.assign(new Error('Promotion payment amount or plan does not match'), { statusCode: 400 })
  }

  const listing = await Product.findById(promotion.listing)
  if (
    !listing
    || String(listing.seller) !== String(promotion.seller)
    || listing.approvalStatus !== 'approved'
    || listing.planVisibilityStatus === 'paused'
    || Number(listing.countInStock) <= 0
  ) {
    await paystackRequest({
      path: '/refund',
      method: 'POST',
      body: { transaction: paymentData.reference, merchant_note: 'Listing became ineligible before campaign activation' }
    })
    promotion.status = 'cancelled'
    promotion.failureReason = 'The listing became ineligible after payment; a refund was requested.'
    promotion.slotNumber = undefined
    await promotion.save()
    return promotion
  }

  const now = new Date()
  promotion.status = 'active'
  promotion.paymentProvider = 'paystack'
  promotion.paymentReference = String(paymentData.reference || '')
  promotion.activatedAt = now
  promotion.startsAt = now
  promotion.endsAt = new Date(now.getTime() + (promotion.durationDays * 24 * 60 * 60 * 1000))
  promotion.failureReason = ''
  await promotion.save()
  await AuditLog.create({
    actor: promotion.seller,
    action: 'homepage_promotion_activated',
    entityType: 'promotion',
    entityId: promotion._id.toString(),
    summary: `Homepage promotion activated for listing ${listing._id} through Paystack`
  })
  return promotion
}

const directCheckoutUnavailable = (res) => {
  if (getMarketplaceConfig().directCheckoutEnabled) return false
  res.status(410).json({
    message: 'Glory does not process buyer-to-seller payments. Use the secure conversation flow to contact the seller.'
  })
  return true
}

const applyVerifiedPayment = async (paymentData) => {
  if (paymentData?.status !== 'success') return null
  const orderId = paymentData.metadata?.orderId
  if (!orderId) throw Object.assign(new Error('Payment metadata is incomplete'), { statusCode: 400 })

  const order = await Order.findById(orderId).populate('buyer', 'name email')
  if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  const expectedAmount = Math.round(Number(order.totalPrice) * 100)
  if (Number(paymentData.amount) !== expectedAmount) {
    throw Object.assign(new Error('Payment amount does not match the order total'), { statusCode: 400 })
  }
  if (order.paymentReference && order.paymentReference !== paymentData.reference) {
    throw Object.assign(new Error('Payment reference does not match this order'), { statusCode: 409 })
  }

  const changed = markOrderPaid(order, {
    id: paymentData.id,
    status: paymentData.status,
    reference: paymentData.reference,
    paidAt: paymentData.paid_at
  })
  if (changed) {
    await order.save()
    await sendOrderStatusEmail({ order, status: 'Payment confirmed' })
  }
  return order
}

router.post('/seller/plan', protect, seller, async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ message: 'Paystack billing is not configured yet' })
    const user = await User.findById(req.user._id).select('+sellerProfile.membershipPaymentReference')
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    const marketCode = normalizeMarketCode(user.sellerProfile.marketCode, 'GB')
    const marketplace = getMarketplaceConfig(marketCode)
    if (marketplace.billingProvider !== 'paystack') {
      return res.status(409).json({ message: `Seller plans in ${marketplace.marketName} are billed through ${marketplace.billingProvider}.` })
    }
    if (user.isEmailVerified === false || !user.twoFactor?.enabled) {
      return res.status(403).json({ message: 'Verify your email and enable two-factor authentication first.' })
    }
    if (user.sellerProfile.verificationStatus !== 'verified') {
      return res.status(403).json({ message: 'Complete seller verification before choosing a paid plan.' })
    }
    if (
      user.sellerProfile.membershipStatus === 'active'
      && user.sellerProfile.membershipPlanCode !== 'starter'
      && user.sellerProfile.membershipCurrentPeriodEnd > new Date()
    ) {
      return res.status(409).json({ message: 'Your current seller plan is already active.' })
    }

    const plan = getSellerPlan(req.body.planCode, marketCode)
    if (!plan || plan.code === 'starter') return res.status(400).json({ message: 'Choose an available paid seller plan.' })
    const reference = `glory-plan-${user._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const response = await paystackRequest({
      path: '/transaction/initialize',
      method: 'POST',
      body: {
        email: user.email,
        amount: plan.feeMinor,
        currency: plan.currency,
        reference,
        channels: ['card', 'bank', 'bank_transfer', 'ussd'],
        metadata: {
          purpose: 'seller_plan',
          userId: user._id.toString(),
          planCode: plan.code,
          marketCode
        },
        callback_url: `${getClientOrigin()}/seller?membership=success`
      }
    })
    user.sellerProfile.membershipPlanCode = plan.code
    user.sellerProfile.membershipStatus = 'pending'
    user.sellerProfile.membershipProvider = 'paystack'
    user.sellerProfile.membershipCurrency = plan.currency
    user.sellerProfile.membershipPaymentReference = response.data?.reference || reference
    await user.save()
    res.json({
      url: response.data?.authorization_url,
      reference: response.data?.reference || reference,
      provider: 'paystack'
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Seller plan checkout could not be started' })
  }
})

router.get('/seller/plan/verify/:reference', protect, seller, async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ message: 'Paystack billing is not configured yet' })
    const response = await paystackRequest({ path: `/transaction/verify/${encodeURIComponent(req.params.reference)}` })
    const metadata = normalizeMetadata(response.data?.metadata)
    if (String(metadata.userId) !== String(req.user._id) || metadata.purpose !== 'seller_plan') {
      return res.status(403).json({ message: 'Not authorized to verify this seller plan.' })
    }
    const user = await applySellerPlanPayment(response.data)
    res.json({
      paymentStatus: response.data?.status,
      membershipStatus: user?.sellerProfile?.membershipStatus || 'pending',
      planCode: user?.sellerProfile?.membershipPlanCode || 'starter'
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Seller plan verification failed' })
  }
})

router.post('/seller/promotions/homepage', protect, verifiedSeller, validatePromotionCheckout, handleValidationErrors, async (req, res) => {
  let promotion
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ message: 'Paystack billing is not configured yet' })
    const marketCode = normalizeMarketCode(req.user.sellerProfile?.marketCode, 'GB')
    const marketplace = getMarketplaceConfig(marketCode)
    if (marketplace.billingProvider !== 'paystack') {
      return res.status(409).json({ message: `Campaigns in ${marketplace.marketName} are billed through ${marketplace.billingProvider}.` })
    }
    const plan = getPromotionPlan(req.body.planCode, marketCode)
    if (!plan) return res.status(400).json({ message: 'That promotion plan is unavailable.' })
    const listing = await Product.findOne({
      _id: req.body.listingId,
      seller: req.user._id,
      marketCode,
      approvalStatus: 'approved',
      planVisibilityStatus: { $ne: 'paused' },
      countInStock: { $gt: 0 }
    })
    if (!listing) return res.status(404).json({ message: 'Choose an approved, in-stock listing from this market.' })

    const price = pricePromotionForSeller(plan, req.user.sellerProfile)
    if (plan.placement === 'homepage_video') {
      const draft = await Promotion.findOne({
        _id: req.body.promotionId,
        seller: req.user._id,
        listing: listing._id,
        marketCode,
        planCode: plan.code,
        status: 'approved_for_payment',
        creativeReviewStatus: 'approved'
      })
      if (!draft) return res.status(409).json({ message: 'This video campaign must be approved before payment.' })
      promotion = await reserveApprovedPromotion(draft._id)
    } else {
      promotion = await reserveHomepagePromotion({
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
        creativeType: 'listing',
        creativeReviewStatus: 'not_required',
        paymentProvider: 'paystack',
        status: 'pending_payment'
      })
    }
    if (!promotion) return res.status(409).json({ message: 'This homepage placement is currently sold out.' })

    const reference = `glory-ad-${promotion._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const response = await paystackRequest({
      path: '/transaction/initialize',
      method: 'POST',
      body: {
        email: req.user.email,
        amount: promotion.amountPence,
        currency: promotion.currency,
        reference,
        channels: ['card', 'bank', 'bank_transfer', 'ussd'],
        metadata: {
          purpose: 'homepage_promotion',
          promotionId: promotion._id.toString(),
          userId: req.user._id.toString(),
          planCode: promotion.planCode,
          marketCode
        },
        callback_url: `${getClientOrigin()}/seller?promotion=success`
      }
    })
    promotion.paymentReference = response.data?.reference || reference
    promotion.paymentProvider = 'paystack'
    await promotion.save()
    res.json({
      url: response.data?.authorization_url,
      reference: response.data?.reference || reference,
      provider: 'paystack'
    })
  } catch (error) {
    if (promotion?.status === 'pending_payment') {
      promotion.status = promotion.creativeType === 'video' ? 'approved_for_payment' : 'failed'
      promotion.failureReason = 'The campaign payment session could not be created.'
      promotion.slotNumber = undefined
      await promotion.save().catch(() => undefined)
    }
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Campaign checkout could not be started' })
  }
})

router.get('/seller/promotions/homepage/verify/:reference', protect, seller, async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(503).json({ message: 'Paystack billing is not configured yet' })
    const response = await paystackRequest({ path: `/transaction/verify/${encodeURIComponent(req.params.reference)}` })
    const metadata = normalizeMetadata(response.data?.metadata)
    if (String(metadata.userId) !== String(req.user._id) || metadata.purpose !== 'homepage_promotion') {
      return res.status(403).json({ message: 'Not authorized to verify this campaign.' })
    }
    const promotion = await applyHomepagePromotionPayment(response.data)
    res.json({ paymentStatus: response.data?.status, promotionStatus: promotion?.status || 'pending', promotion })
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Campaign payment verification failed' })
  }
})

router.post('/initialize', protect, async (req, res) => {
  try {
    if (directCheckoutUnavailable(res)) return
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ message: 'Payment provider is not configured' })
    }
    if (!process.env.PAYSTACK_CURRENCY) {
      return res.status(503).json({ message: 'Legacy payment currency is not configured' })
    }
    const order = await Order.findById(req.body.orderId)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to pay this order' })
    }
    if (order.isPaid) return res.status(409).json({ message: 'This order is already paid' })
    if (!order.stockReserved || (order.reservationExpiresAt && order.reservationExpiresAt < new Date())) {
      return res.status(409).json({ message: 'This checkout reservation expired. Return to your bag and try again.' })
    }

    const response = await paystackRequest({
      path: '/transaction/initialize',
      method: 'POST',
      body: {
        email: req.user.email,
        amount: Math.round(Number(order.totalPrice) * 100),
        currency: process.env.PAYSTACK_CURRENCY,
        metadata: { orderId: order._id.toString(), userId: req.user._id.toString() },
        callback_url: `${getClientOrigin()}/payment/verify`
      }
    })
    if (response.data?.reference) {
      order.paymentReference = response.data.reference
      await order.save()
    }
    res.json(response)
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Payment initialization failed' })
  }
})

router.get('/verify/:reference', protect, async (req, res) => {
  try {
    if (directCheckoutUnavailable(res)) return
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ message: 'Payment provider is not configured' })
    }
    const response = await paystackRequest({ path: `/transaction/verify/${encodeURIComponent(req.params.reference)}` })
    const order = await applyVerifiedPayment(response.data)
    if (order && !canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to verify this order' })
    }
    res.json({ ...response, orderId: order?._id })
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Payment verification failed' })
  }
})

const handleWebhook = async (req, res) => {
  try {
    const signature = req.get('x-paystack-signature') || ''
    const expected = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(req.body)
      .digest('hex')
    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (!signature || signatureBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return res.status(401).send('Invalid signature')
    }
    const event = JSON.parse(req.body.toString('utf8'))
    if (event.event === 'charge.success') {
      const metadata = normalizeMetadata(event.data?.metadata)
      if (metadata.purpose === 'seller_plan') {
        await applySellerPlanPayment(event.data)
      } else if (metadata.purpose === 'homepage_promotion') {
        await applyHomepagePromotionPayment(event.data)
      } else if (getMarketplaceConfig().directCheckoutEnabled) {
        await applyVerifiedPayment(event.data)
      }
    }
    res.sendStatus(200)
  } catch (error) {
    logger.error({ type: 'PAYSTACK_WEBHOOK_FAILED', message: error.message })
    res.sendStatus(500)
  }
}

router.handleWebhook = handleWebhook
router.applySellerPlanPayment = applySellerPlanPayment
router.applyHomepagePromotionPayment = applyHomepagePromotionPayment
module.exports = router
