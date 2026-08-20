const express = require('express')
const Stripe = require('stripe')
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
  getSellerPlans,
  normalizeMarketCode,
  pricePromotionForSeller
} = require('../services/marketplaceService')
const { validatePromotionCheckout, handleValidationErrors } = require('../middleware/security')
const {
  getSellerCommerceStatus,
  transferOrderAllocations,
  updateConnectedAccountStatus
} = require('../services/stripeMarketplaceService')
const { sendOrderStatusEmail } = require('../utils/email')
const { logger } = require('../middleware/logger')
const { reserveApprovedPromotion, reserveHomepagePromotion } = require('../services/promotionService')
const { enforceSellerPlanVisibility } = require('../services/sellerPlanEnforcementService')

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

const configuredClientOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL
].filter(Boolean)

const getClientOrigin = () => configuredClientOrigins[0]
  || (process.env.NODE_ENV === 'production' ? 'https://glory-ca.vercel.app' : 'http://localhost:3000')

const sellerCheckoutTaxSettings = () => (
  process.env.STRIPE_AUTOMATIC_TAX === 'true'
    ? {
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true }
      }
    : {}
)

const checkoutSubtotal = (session) => Number(session.amount_subtotal ?? session.amount_total)

const canAccessOrder = (order, user) => {
  const buyerId = order.buyer?._id || order.buyer
  return user.isAdmin || buyerId?.toString() === user._id.toString()
}

const directCheckoutUnavailable = (res) => {
  if (getMarketplaceConfig().directCheckoutEnabled) return false
  res.status(410).json({
    message: 'Glory does not process buyer-to-seller payments. Use the secure conversation flow to contact the seller.'
  })
  return true
}

const publicSellerPlan = (plan) => ({
  code: plan.code,
  label: plan.label,
  description: plan.description,
  feeMinor: plan.feeMinor,
  feePence: plan.feePence,
  currency: plan.currency,
  marketCode: plan.marketCode,
  billingProvider: plan.billingProvider,
  interval: plan.interval,
  activeListingLimit: plan.activeListingLimit,
  promotionDiscountBps: plan.promotionDiscountBps,
  features: plan.features
})

const stripeSubscriptionPeriodEnd = (subscription) => {
  const itemPeriods = subscription?.items?.data
    ?.map((item) => Number(item.current_period_end || 0))
    .filter(Boolean) || []
  const unixSeconds = Number(subscription?.current_period_end || Math.max(0, ...itemPeriods))
  return unixSeconds ? new Date(unixSeconds * 1000) : undefined
}

const membershipStatusFromStripe = (status) => {
  if (['active', 'trialing'].includes(status)) return 'active'
  if (['past_due', 'unpaid', 'incomplete'].includes(status)) return 'past_due'
  if (['canceled', 'incomplete_expired', 'paused'].includes(status)) return 'cancelled'
  return 'pending'
}

const applySellerSubscription = async (subscription, fallback = {}) => {
  if (!subscription) return null
  const userId = subscription.metadata?.userId || fallback.userId
  const planCode = subscription.metadata?.planCode || fallback.planCode
  const marketCode = normalizeMarketCode(subscription.metadata?.marketCode || fallback.marketCode, 'GB')
  const plan = getSellerPlan(planCode, marketCode)
  if (!userId || !plan || plan.code === 'starter') {
    throw Object.assign(new Error('Seller plan metadata is incomplete'), { statusCode: 400 })
  }

  const user = await User.findById(userId)
    .select('+sellerProfile.billingCustomerId +sellerProfile.billingSubscriptionId')
  if (!user?.isSeller) {
    throw Object.assign(new Error('Seller account not found'), { statusCode: 404 })
  }
  if (normalizeMarketCode(user.sellerProfile.marketCode, 'GB') !== marketCode) {
    throw Object.assign(new Error('Seller plan market does not match this store'), { statusCode: 409 })
  }

  user.sellerProfile.membershipPlanCode = plan.code
  user.sellerProfile.membershipStatus = membershipStatusFromStripe(subscription.status)
  user.sellerProfile.membershipCurrentPeriodEnd = stripeSubscriptionPeriodEnd(subscription)
  user.sellerProfile.membershipCancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end)
  user.sellerProfile.membershipProvider = 'stripe'
  user.sellerProfile.membershipCurrency = plan.currency
  user.sellerProfile.billingCustomerId = String(subscription.customer || fallback.customerId || '')
  user.sellerProfile.billingSubscriptionId = String(subscription.id || fallback.subscriptionId || '')
  await user.save()
  await enforceSellerPlanVisibility(user._id)
  return user
}

const applySellerSubscriptionSession = async (session) => {
  if (session?.metadata?.purpose !== 'seller_subscription') return null
  const marketCode = normalizeMarketCode(session.metadata?.marketCode, 'GB')
  const plan = getSellerPlan(session.metadata?.planCode, marketCode)
  if (!plan || plan.code === 'starter') {
    throw Object.assign(new Error('Seller plan is unavailable'), { statusCode: 400 })
  }
  if (
    session.currency !== String(plan.currency).toLowerCase()
    || checkoutSubtotal(session) !== Number(plan.feePence)
  ) {
    throw Object.assign(new Error('Seller plan amount or currency does not match'), { statusCode: 400 })
  }
  if (!session.subscription) {
    throw Object.assign(new Error('Seller subscription is not ready yet'), { statusCode: 409 })
  }

  const subscription = typeof session.subscription === 'object'
    ? session.subscription
    : await stripe.subscriptions.retrieve(session.subscription)
  return applySellerSubscription(subscription, {
    userId: session.metadata?.userId,
    planCode: plan.code,
    marketCode,
    customerId: session.customer,
    subscriptionId: session.subscription
  })
}

const identityStatusFromStripe = (status) => {
  if (status === 'verified') return 'verified'
  if (status === 'processing') return 'processing'
  if (status === 'canceled') return 'cancelled'
  return 'requires_input'
}

const applyIdentityVerificationSession = async (session) => {
  if (!session) return null
  const user = session.metadata?.userId
    ? await User.findById(session.metadata.userId).select('+sellerProfile.identityVerification.sessionId')
    : await User.findOne({ 'sellerProfile.identityVerification.sessionId': session.id })
      .select('+sellerProfile.identityVerification.sessionId')
  if (!user?.isSeller) return null

  const identity = user.sellerProfile.identityVerification
  identity.provider = 'stripe_identity'
  identity.sessionId = session.id
  identity.status = identityStatusFromStripe(session.status)
  identity.lastCheckedAt = new Date()
  identity.lastErrorCode = String(session.last_error?.code || '').slice(0, 80)
  identity.lastErrorReason = String(session.last_error?.reason || '').slice(0, 300)
  if (session.status === 'verified') {
    identity.verifiedAt = identity.verifiedAt || new Date()
    identity.lastErrorCode = ''
    identity.lastErrorReason = ''
  }
  if (session.redaction?.status === 'processing') {
    identity.status = 'redaction_pending'
  }
  if (session.redaction?.status === 'redacted') {
    identity.status = 'redacted'
    identity.redactedAt = new Date()
    if (user.sellerProfile.verificationStatus === 'verified') {
      user.sellerProfile.verificationStatus = 'incomplete'
      user.sellerProfile.verificationNote = 'Identity verification data was removed. Complete a new identity check before selling again.'
    }
  }
  await user.save()
  return user
}

const applySellerActivationSession = async (session) => {
  if (session?.payment_status !== 'paid' || session.metadata?.purpose !== 'seller_activation') {
    return null
  }

  const marketCode = normalizeMarketCode(session.metadata?.marketCode, 'GB')
  const marketplace = getMarketplaceConfig(marketCode)
  const userId = session.metadata?.userId
  if (!userId) throw Object.assign(new Error('Seller activation metadata is incomplete'), { statusCode: 400 })
  if (
    session.currency !== String(marketplace.currency).toLowerCase()
    || checkoutSubtotal(session) !== marketplace.sellerActivationFeePence
  ) {
    throw Object.assign(new Error('Seller activation currency or amount does not match'), { statusCode: 400 })
  }

  const user = await User.findById(userId)
  if (!user?.isSeller) {
    throw Object.assign(new Error('Seller account not found'), { statusCode: 404 })
  }
  if (normalizeMarketCode(user.sellerProfile.marketCode, 'GB') !== marketCode) {
    throw Object.assign(new Error('Seller activation market does not match this store'), { statusCode: 409 })
  }
  if (user.sellerProfile.activationStatus === 'paid') return user

  user.sellerProfile.activationStatus = 'paid'
  user.sellerProfile.activationAmountPence = marketplace.sellerActivationFeePence
  user.sellerProfile.activationCurrency = marketplace.currency
  user.sellerProfile.activationPaymentReference = session.id
  user.sellerProfile.activationPaidAt = user.sellerProfile.activationPaidAt || new Date()
  await user.save()
  return user
}

const applyHomepagePromotionSession = async (session) => {
  if (session?.payment_status !== 'paid' || session.metadata?.purpose !== 'homepage_promotion') {
    return null
  }

  const promotionId = session.metadata?.promotionId
  const userId = session.metadata?.userId
  if (!promotionId || !userId) {
    throw Object.assign(new Error('Promotion payment metadata is incomplete'), { statusCode: 400 })
  }

  const promotion = await Promotion.findById(promotionId).select('+paymentReference +paymentIntentId')
  if (!promotion || String(promotion.seller) !== String(userId)) {
    throw Object.assign(new Error('Promotion not found'), { statusCode: 404 })
  }
  if (promotion.status === 'active') return promotion

  if (
    session.currency !== String(promotion.currency).toLowerCase()
    || checkoutSubtotal(session) !== Number(promotion.amountPence)
    || session.metadata?.planCode !== promotion.planCode
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
    if (session.payment_intent) {
      await stripe.refunds.create({
        payment_intent: String(session.payment_intent),
        reason: 'requested_by_customer',
        metadata: {
          purpose: 'homepage_promotion_eligibility_refund',
          promotionId: promotion._id.toString()
        }
      }, {
        idempotencyKey: `glory-promotion-ineligible-refund-${promotion._id}`
      })
    }
    promotion.status = 'cancelled'
    promotion.failureReason = 'The listing became ineligible after payment; the promotion payment was refunded.'
    promotion.slotNumber = undefined
    await promotion.save()
    return promotion
  }

  const now = new Date()
  promotion.status = 'active'
  promotion.paymentReference = session.id
  promotion.paymentIntentId = String(session.payment_intent || '')
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
    summary: `Homepage promotion activated for listing ${listing._id}`
  })
  return promotion
}

const applyVerifiedOrderSession = async (session) => {
  if (session?.payment_status !== 'paid') return null

  const orderId = session.metadata?.orderId
  if (!orderId) throw Object.assign(new Error('Payment metadata is incomplete'), { statusCode: 400 })

  const order = await Order.findById(orderId).populate('buyer', 'name email')
  if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })

  const expectedAmount = Number(order.totalPricePence || Math.round(Number(order.totalPrice) * 100))
  if (session.currency !== 'gbp' || Number(session.amount_total) !== expectedAmount) {
    throw Object.assign(new Error('Payment currency or amount does not match the order total'), { statusCode: 400 })
  }
  if (order.paymentReference && order.paymentReference !== session.id) {
    throw Object.assign(new Error('Payment reference does not match this order'), { statusCode: 409 })
  }

  const changed = markOrderPaid(order, {
    id: String(session.payment_intent || session.id),
    status: session.payment_status,
    reference: session.id,
    paidAt: new Date().toISOString()
  })
  if (changed) {
    await order.save()
    await sendOrderStatusEmail({ order, status: 'Payment confirmed' })
  }
  await transferOrderAllocations({
    stripe,
    order,
    paymentIntentId: String(session.payment_intent || ''),
    logger
  })
  return order
}

router.get('/status', (req, res) => {
  const marketplace = getMarketplaceConfig(req.query.market)
  res.json({
    enabled: marketplace.billingProvider === 'stripe' && Boolean(stripe),
    currency: marketplace.currency,
    sellerActivationRequired: marketplace.sellerActivationRequired,
    sellerActivationFeePence: marketplace.sellerActivationFeePence,
    platformCommissionBps: marketplace.platformCommissionBps,
    marketplaceMode: marketplace.marketplaceMode,
    directCheckoutEnabled: marketplace.directCheckoutEnabled,
    paymentMethods: marketplace.paymentMethods,
    sellerPlans: getSellerPlans(marketplace.marketCode).map(publicSellerPlan)
  })
})

router.get('/seller/status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    const marketplace = getMarketplaceConfig(user.sellerProfile.marketCode)

    if (stripe && user.sellerProfile.stripeAccountId) {
      const account = await stripe.accounts.retrieve(user.sellerProfile.stripeAccountId)
      await updateConnectedAccountStatus(user, account)
    }

    res.json({
      ...getSellerCommerceStatus(user, marketplace),
      paymentMethods: marketplace.paymentMethods,
      sellerPlans: getSellerPlans(marketplace.marketCode).map(publicSellerPlan)
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Unable to load seller payment status'
    })
  }
})

router.get('/seller/identity/status', protect, seller, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('+sellerProfile.identityVerification.sessionId')
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    const identity = user.sellerProfile.identityVerification
    if (stripe && identity?.sessionId && !['redacted', 'redaction_pending'].includes(identity.status)) {
      const session = await stripe.identity.verificationSessions.retrieve(identity.sessionId)
      await applyIdentityVerificationSession(session)
    }
    const refreshed = await User.findById(req.user._id)
    res.json(refreshed?.sellerProfile?.identityVerification || { provider: 'none', status: 'not_started' })
  } catch (error) {
    res.status(500).json({ message: 'Unable to load identity verification status.' })
  }
})

router.post('/seller/identity/session', protect, seller, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Hosted identity verification is not configured yet.' })
    if (req.body.acceptDisclosure !== true) {
      return res.status(400).json({ message: 'Review and accept the identity-verification privacy disclosure first.' })
    }
    const user = await User.findById(req.user._id)
      .select('+sellerProfile.identityVerification.sessionId')
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    if (user.isEmailVerified === false || !user.twoFactor?.enabled) {
      return res.status(403).json({ message: 'Verify your email and enable two-factor authentication first.' })
    }

    const identity = user.sellerProfile.identityVerification
    if (identity?.status === 'verified') {
      return res.json({ alreadyVerified: true, status: 'verified' })
    }
    if (identity?.sessionId && !['cancelled', 'redacted'].includes(identity.status)) {
      const existing = await stripe.identity.verificationSessions.retrieve(identity.sessionId)
      await applyIdentityVerificationSession(existing)
      if (existing.status === 'verified') return res.json({ alreadyVerified: true, status: 'verified' })
      if (existing.status === 'processing') return res.json({ status: 'processing' })
      if (existing.url && existing.status === 'requires_input') {
        return res.json({ url: existing.url, status: existing.status })
      }
    }

    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      client_reference_id: user._id.toString(),
      metadata: { userId: user._id.toString(), purpose: 'seller_identity' },
      provided_details: { email: user.email },
      options: {
        document: {
          allowed_types: ['passport', 'driving_license', 'id_card'],
          require_matching_selfie: true
        }
      },
      return_url: `${getClientOrigin()}/seller?identity=return`
    })
    identity.provider = 'stripe_identity'
    identity.status = identityStatusFromStripe(session.status)
    identity.sessionId = session.id
    identity.disclosureAcceptedAt = new Date()
    identity.lastCheckedAt = new Date()
    identity.lastErrorCode = ''
    identity.lastErrorReason = ''
    await user.save()
    await AuditLog.create({
      actor: user._id,
      action: 'seller_identity_started',
      entityType: 'seller_identity',
      entityId: user._id.toString(),
      summary: 'Hosted seller identity verification started',
      requestId: req.requestId || ''
    })
    res.json({ url: session.url, status: session.status })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Identity verification could not be started.'
    })
  }
})

router.post('/seller/identity/redact', protect, seller, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Hosted identity verification is not configured yet.' })
    const user = await User.findById(req.user._id)
      .select('+sellerProfile.identityVerification.sessionId')
    if (!user || user.privacy?.deletionStatus !== 'pending') {
      return res.status(403).json({ message: 'Identity redaction is available as part of a confirmed account-deletion request.' })
    }
    const identity = user.sellerProfile.identityVerification
    if (!identity?.sessionId) return res.json({ status: 'not_started' })
    const session = await stripe.identity.verificationSessions.redact(identity.sessionId)
    identity.redactionRequestedAt = new Date()
    identity.status = session.redaction?.status === 'redacted' ? 'redacted' : 'redaction_pending'
    identity.redactedAt = identity.status === 'redacted' ? new Date() : undefined
    await user.save()
    res.json({ status: identity.status })
  } catch (error) {
    res.status(500).json({ message: 'Identity verification data could not be scheduled for redaction.' })
  }
})

router.post('/seller/subscription', protect, seller, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Seller plan payments are not configured yet' })
    const user = await User.findById(req.user._id)
      .select('+sellerProfile.billingCustomerId +sellerProfile.billingSubscriptionId')
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    const marketCode = normalizeMarketCode(user.sellerProfile.marketCode, 'GB')
    const marketplace = getMarketplaceConfig(marketCode)
    if (marketplace.billingProvider !== 'stripe') {
      return res.status(409).json({ message: `Seller plans in ${marketplace.marketName} are billed through ${marketplace.billingProvider}.` })
    }
    const plan = getSellerPlan(req.body.planCode, marketCode)
    if (!plan || plan.code === 'starter' || !plan.interval) {
      return res.status(400).json({ message: 'Choose an available paid seller plan.' })
    }
    if (user.isEmailVerified === false || !user.twoFactor?.enabled) {
      return res.status(403).json({ message: 'Verify your email and enable two-factor authentication first' })
    }
    if (user.sellerProfile.verificationStatus !== 'verified') {
      return res.status(403).json({ message: 'Complete seller verification before choosing a paid plan.' })
    }
    if (
      user.sellerProfile.billingSubscriptionId
      && ['active', 'pending', 'past_due'].includes(user.sellerProfile.membershipStatus)
    ) {
      return res.status(409).json({
        message: 'Manage your existing paid plan before starting another subscription.',
        manageBilling: true
      })
    }

    const lineItem = plan.stripePriceId
      ? { price: plan.stripePriceId, quantity: 1 }
      : {
          price_data: {
            currency: String(plan.currency).toLowerCase(),
            unit_amount: plan.feePence,
            recurring: { interval: plan.interval },
            product_data: {
              name: `Glory ${plan.label} seller plan`,
              description: `${plan.activeListingLimit} active listings with ${plan.promotionDiscountBps / 100}% off paid visibility.`
            }
          },
          quantity: 1
        }

    const sessionPayload = {
      mode: 'subscription',
      line_items: [lineItem],
      client_reference_id: user._id.toString(),
      metadata: {
        purpose: 'seller_subscription',
        userId: user._id.toString(),
        planCode: plan.code,
        marketCode
      },
      subscription_data: {
        metadata: {
          purpose: 'seller_subscription',
          userId: user._id.toString(),
          planCode: plan.code,
          marketCode
        }
      },
      ...sellerCheckoutTaxSettings(),
      success_url: `${getClientOrigin()}/seller?membership=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getClientOrigin()}/seller?membership=cancelled`
    }
    if (user.sellerProfile.billingCustomerId) {
      sessionPayload.customer = user.sellerProfile.billingCustomerId
    } else {
      sessionPayload.customer_email = user.email
    }

    const session = await stripe.checkout.sessions.create(sessionPayload, {
      idempotencyKey: `glory-seller-plan-${user._id}-${plan.code}-${Date.now().toString().slice(0, -4)}`
    })
    user.sellerProfile.membershipPlanCode = plan.code
    user.sellerProfile.membershipStatus = 'pending'
    user.sellerProfile.membershipProvider = 'stripe'
    user.sellerProfile.membershipCurrency = plan.currency
    await user.save()
    await AuditLog.create({
      actor: user._id,
      action: 'seller_subscription_checkout_started',
      entityType: 'seller_subscription',
      entityId: user._id.toString(),
      summary: `${plan.label} seller plan checkout started`,
      requestId: req.requestId || ''
    })
    res.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Seller plan checkout could not be started'
    })
  }
})

router.get('/seller/subscription/verify/:sessionId', protect, seller, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Seller plan payments are not configured yet' })
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId, {
      expand: ['subscription']
    })
    if (
      session.metadata?.purpose !== 'seller_subscription'
      || String(session.metadata?.userId) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: 'Not authorized to verify this seller plan.' })
    }
    const user = await applySellerSubscriptionSession(session)
    res.json({
      paymentStatus: session.payment_status,
      membershipStatus: user?.sellerProfile?.membershipStatus || 'pending',
      planCode: user?.sellerProfile?.membershipPlanCode || 'starter'
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Seller plan verification failed'
    })
  }
})

router.post('/seller/subscription/portal', protect, seller, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Seller billing is not configured yet' })
    const user = await User.findById(req.user._id)
      .select('+sellerProfile.billingCustomerId')
    if (!user?.sellerProfile?.billingCustomerId) {
      return res.status(404).json({ message: 'No paid seller plan is available to manage.' })
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.sellerProfile.billingCustomerId,
      return_url: `${getClientOrigin()}/seller`
    })
    res.json({ url: session.url })
  } catch (error) {
    res.status(500).json({ message: 'Seller billing portal could not be opened.' })
  }
})

router.post('/seller/activation', protect, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Seller activation payments are not configured yet' })

    const user = await User.findById(req.user._id)
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    const marketCode = normalizeMarketCode(user.sellerProfile.marketCode, 'GB')
    const marketplace = getMarketplaceConfig(marketCode)
    if (marketplace.billingProvider !== 'stripe') {
      return res.status(409).json({ message: `Seller activation in ${marketplace.marketName} is billed through ${marketplace.billingProvider}.` })
    }
    if (user.isEmailVerified === false || !user.twoFactor?.enabled) {
      return res.status(403).json({ message: 'Verify your email and enable two-factor authentication first' })
    }
    if (user.sellerProfile.verificationStatus !== 'verified') {
      return res.status(403).json({ message: 'Seller verification must be approved before activation payment' })
    }
    if (['paid', 'waived'].includes(user.sellerProfile.activationStatus)) {
      return res.json({ alreadyActive: true })
    }
    if (!marketplace.sellerActivationRequired || marketplace.sellerActivationFeePence === 0) {
      user.sellerProfile.activationStatus = 'waived'
      user.sellerProfile.activationAmountPence = 0
      await user.save()
      return res.json({ alreadyActive: true })
    }

    if (
      user.sellerProfile.activationStatus === 'pending'
      && user.sellerProfile.activationPaymentReference
    ) {
      const pendingSession = await stripe.checkout.sessions.retrieve(
        user.sellerProfile.activationPaymentReference
      )
      if (pendingSession.payment_status === 'paid') {
        await applySellerActivationSession(pendingSession)
        return res.json({ alreadyActive: true })
      }
      if (pendingSession.status === 'open' && pendingSession.url) {
        return res.json({ url: pendingSession.url, sessionId: pendingSession.id })
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: String(marketplace.currency).toLowerCase(),
          unit_amount: marketplace.sellerActivationFeePence,
          product_data: {
            name: 'Glory seller activation',
            description: 'One-time marketplace seller account activation'
          }
        },
        quantity: 1
      }],
      metadata: {
        purpose: 'seller_activation',
        userId: user._id.toString(),
        marketCode
      },
      payment_intent_data: {
        metadata: {
          purpose: 'seller_activation',
          userId: user._id.toString(),
          marketCode
        }
      },
      ...sellerCheckoutTaxSettings(),
      success_url: `${getClientOrigin()}/seller?activation=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getClientOrigin()}/seller?activation=cancelled`
    })

    user.sellerProfile.activationStatus = 'pending'
    user.sellerProfile.activationAmountPence = marketplace.sellerActivationFeePence
    user.sellerProfile.activationCurrency = marketplace.currency
    user.sellerProfile.activationPaymentReference = session.id
    await user.save()
    res.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Seller activation payment could not be started'
    })
  }
})

router.get('/seller/activation/verify/:sessionId', protect, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Seller activation payments are not configured yet' })
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId)
    if (String(session.metadata?.userId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized to verify this activation' })
    }
    const user = await applySellerActivationSession(session)
    res.json({
      paymentStatus: session.payment_status,
      activationStatus: user?.sellerProfile?.activationStatus || 'pending'
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Seller activation verification failed'
    })
  }
})

router.post('/seller/promotions/homepage', protect, verifiedSeller, validatePromotionCheckout, handleValidationErrors, async (req, res) => {
  let promotion
  try {
    if (!stripe) return res.status(503).json({ message: 'Promotion payments are not configured yet' })

    const marketCode = normalizeMarketCode(req.user.sellerProfile?.marketCode, 'GB')
    const marketplace = getMarketplaceConfig(marketCode)
    if (marketplace.billingProvider !== 'stripe') {
      return res.status(409).json({ message: `Campaigns in ${marketplace.marketName} are billed through ${marketplace.billingProvider}.` })
    }
    const plan = getPromotionPlan(req.body.planCode, marketCode)
    if (!plan) {
      return res.status(400).json({ message: 'That promotion plan is unavailable.' })
    }
    const promotionPrice = pricePromotionForSeller(plan, req.user.sellerProfile)

    const listing = await Product.findOne({
      _id: req.body.listingId,
      seller: req.user._id,
      marketCode,
      approvalStatus: 'approved',
      planVisibilityStatus: { $ne: 'paused' },
      countInStock: { $gt: 0 }
    })
    if (!listing) {
      return res.status(404).json({ message: 'Choose one of your approved, in-stock listings to promote.' })
    }

    const now = new Date()
    const existing = await Promotion.findOne({
      seller: req.user._id,
      listing: listing._id,
      marketCode,
      placement: plan.placement,
      status: { $in: ['pending_payment', 'active'] }
    }).select('+paymentReference')

    if (existing?.status === 'active' && existing.endsAt > now) {
      return res.json({ alreadyActive: true, promotion: existing })
    }
    if (existing?.status === 'active') {
      existing.status = 'expired'
      existing.slotNumber = undefined
      await existing.save()
    }
    if (existing?.status === 'pending_payment' && existing.paymentReference) {
      const pendingSession = await stripe.checkout.sessions.retrieve(existing.paymentReference)
      if (pendingSession.payment_status === 'paid') {
        const activePromotion = await applyHomepagePromotionSession(pendingSession)
        return res.json({ alreadyActive: activePromotion?.status === 'active', promotion: activePromotion })
      }
      if (pendingSession.status === 'open' && pendingSession.url) {
        return res.json({ url: pendingSession.url, sessionId: pendingSession.id, promotion: existing })
      }
      existing.status = 'failed'
      existing.failureReason = 'The previous promotion payment session expired.'
      existing.slotNumber = undefined
      await existing.save()
    }

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
      if (!draft) {
        return res.status(409).json({ message: 'This video campaign must be approved before payment.' })
      }
      promotion = await reserveApprovedPromotion(draft._id)
    } else {
      promotion = await reserveHomepagePromotion({
        seller: req.user._id,
        listing: listing._id,
        marketCode,
        placement: plan.placement,
        planCode: plan.code,
        label: plan.label,
        baseAmountPence: promotionPrice.baseFeePence,
        discountPence: promotionPrice.discountPence,
        amountPence: promotionPrice.feePence,
        sellerPlanCode: promotionPrice.sellerPlanCode,
        currency: plan.currency,
        durationDays: plan.durationDays,
        creativeType: 'listing',
        creativeReviewStatus: 'not_required',
        paymentProvider: 'stripe',
        status: 'pending_payment'
      })
    }
    if (!promotion) {
      return res.status(409).json({ message: 'This homepage placement is sold out for the current period. Please try again when a slot becomes available.' })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      line_items: [{
        price_data: {
          currency: String(plan.currency).toLowerCase(),
          unit_amount: promotion.amountPence,
          product_data: {
            name: `Glory ${plan.label}`,
            description: `${plan.durationDays}-day Sponsored homepage placement for ${listing.name}`
          }
        },
        quantity: 1
      }],
      metadata: {
        purpose: 'homepage_promotion',
        promotionId: promotion._id.toString(),
        userId: req.user._id.toString(),
        planCode: plan.code,
        marketCode
      },
      payment_intent_data: {
        metadata: {
          purpose: 'homepage_promotion',
          promotionId: promotion._id.toString(),
          userId: req.user._id.toString(),
          planCode: plan.code,
          marketCode
        }
      },
      ...sellerCheckoutTaxSettings(),
      success_url: `${getClientOrigin()}/seller?promotion=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getClientOrigin()}/seller?promotion=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60)
    }, {
      idempotencyKey: `glory-homepage-promotion-${promotion._id}`
    })

    promotion.paymentReference = session.id
    await promotion.save()
    await AuditLog.create({
      actor: req.user._id,
      action: 'homepage_promotion_checkout_started',
      entityType: 'promotion',
      entityId: promotion._id.toString(),
      summary: `Homepage promotion checkout started for listing ${listing._id}`,
      requestId: req.requestId || ''
    })
    res.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    if (promotion && promotion.status === 'pending_payment') {
      promotion.status = promotion.creativeType === 'video' ? 'approved_for_payment' : 'failed'
      promotion.failureReason = 'The promotion payment session could not be created.'
      promotion.slotNumber = undefined
      await promotion.save().catch(() => undefined)
    }
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Promotion payment could not be started'
    })
  }
})

router.get('/seller/promotions/homepage/verify/:sessionId', protect, seller, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Promotion payments are not configured yet' })
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId)
    if (
      session.metadata?.purpose !== 'homepage_promotion'
      || String(session.metadata?.userId) !== String(req.user._id)
    ) {
      return res.status(403).json({ message: 'Not authorized to verify this promotion payment' })
    }
    const promotion = await applyHomepagePromotionSession(session)
    res.json({
      paymentStatus: session.payment_status,
      promotionStatus: promotion?.status || 'pending',
      promotion
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Promotion payment verification failed'
    })
  }
})

router.post('/connect/onboard', protect, async (req, res) => {
  try {
    if (directCheckoutUnavailable(res)) return
    if (!stripe) return res.status(503).json({ message: 'Seller payouts are not configured yet' })

    const marketplace = getMarketplaceConfig()
    const user = await User.findById(req.user._id)
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    if (user.isEmailVerified === false || !user.twoFactor?.enabled) {
      return res.status(403).json({ message: 'Verify your email and enable two-factor authentication first' })
    }
    if (user.sellerProfile.verificationStatus !== 'verified') {
      return res.status(403).json({ message: 'Seller verification must be approved before payout onboarding' })
    }
    if (
      marketplace.sellerActivationRequired
      && !['paid', 'waived'].includes(user.sellerProfile.activationStatus)
    ) {
      return res.status(403).json({ message: 'Complete the seller activation payment first' })
    }

    if (!user.sellerProfile.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: user.sellerProfile.businessEmail || user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        metadata: { userId: user._id.toString() }
      }, {
        idempotencyKey: `glory-connect-account-${user._id}`
      })
      user.sellerProfile.stripeAccountId = account.id
      user.sellerProfile.payoutStatus = 'pending'
      user.sellerProfile.payoutStatusUpdatedAt = new Date()
      await user.save()
    }

    const accountLink = await stripe.accountLinks.create({
      account: user.sellerProfile.stripeAccountId,
      refresh_url: `${getClientOrigin()}/seller?payout=refresh`,
      return_url: `${getClientOrigin()}/seller?payout=return`,
      type: 'account_onboarding'
    })
    res.json({ url: accountLink.url })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Seller payout onboarding could not be started'
    })
  }
})

router.post('/initialize', protect, async (req, res) => {
  try {
    if (directCheckoutUnavailable(res)) return
    if (!stripe) {
      return res.status(503).json({ message: 'UK card payments are not configured yet' })
    }

    const order = await Order.findById(req.body.orderId)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to pay this order' })
    }
    if (order.paymentMethod !== 'Stripe') {
      return res.status(409).json({ message: 'This order was not created for Stripe payment' })
    }
    if (order.isPaid) return res.status(409).json({ message: 'This order is already paid' })
    if (!order.stockReserved || (order.reservationExpiresAt && order.reservationExpiresAt < new Date())) {
      return res.status(409).json({ message: 'This checkout reservation expired. Return to your bag and try again.' })
    }

    order.transferGroup = order.transferGroup || `GLORY_ORDER_${order._id}`
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      billing_address_collection: 'required',
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: Math.round(Number(order.totalPrice) * 100),
          product_data: {
            name: `Glory order ${order._id.toString().slice(-8).toUpperCase()}`,
            description: `${order.orderItems.length} beauty item${order.orderItems.length === 1 ? '' : 's'} including delivery`
          }
        },
        quantity: 1
      }],
      metadata: {
        orderId: order._id.toString(),
        userId: req.user._id.toString()
      },
      payment_intent_data: {
        transfer_group: order.transferGroup,
        metadata: {
          orderId: order._id.toString(),
          userId: req.user._id.toString()
        }
      },
      success_url: `${getClientOrigin()}/payment/verify?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getClientOrigin()}/checkout`,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60)
    })

    order.paymentReference = session.id
    await order.save()
    res.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Payment initialization failed'
    })
  }
})

router.get('/verify/:sessionId', protect, async (req, res) => {
  try {
    if (directCheckoutUnavailable(res)) return
    if (!stripe) {
      return res.status(503).json({ message: 'UK card payments are not configured yet' })
    }

    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId)
    const order = await Order.findById(session.metadata?.orderId)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to verify this order' })
    }

    await applyVerifiedOrderSession(session)
    res.json({
      paymentStatus: session.payment_status,
      orderId: order._id
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Payment verification failed'
    })
  }
})

const handleWebhook = async (req, res) => {
  try {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send('Stripe webhook is not configured')
    }

    const signature = req.get('stripe-signature')
    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )

    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const session = event.data.object
      if (session.metadata?.purpose === 'seller_subscription') {
        await applySellerSubscriptionSession(session)
      } else if (session.metadata?.purpose === 'seller_activation') {
        await applySellerActivationSession(session)
      } else if (session.metadata?.purpose === 'homepage_promotion') {
        await applyHomepagePromotionSession(session)
      } else if (getMarketplaceConfig().directCheckoutEnabled) {
        await applyVerifiedOrderSession(session)
      }
    }
    if (event.type === 'account.updated') {
      const account = event.data.object
      const user = account.metadata?.userId
        ? await User.findById(account.metadata.userId)
        : await User.findOne({ 'sellerProfile.stripeAccountId': account.id })
      if (user) await updateConnectedAccountStatus(user, account)
    }
    if ([
      'identity.verification_session.processing',
      'identity.verification_session.verified',
      'identity.verification_session.requires_input',
      'identity.verification_session.canceled',
      'identity.verification_session.redacted'
    ].includes(event.type)) {
      await applyIdentityVerificationSession(event.data.object)
    }
    if (['customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const subscription = event.data.object
      const user = subscription.metadata?.userId
        ? await User.findById(subscription.metadata.userId)
        : await User.findOne({ 'sellerProfile.billingSubscriptionId': subscription.id })
      if (user) {
        if (!subscription.metadata?.userId) subscription.metadata = {
          ...(subscription.metadata || {}),
          userId: user._id.toString(),
          planCode: user.sellerProfile?.membershipPlanCode,
          marketCode: normalizeMarketCode(user.sellerProfile?.marketCode, 'GB')
        }
        await applySellerSubscription(subscription)
      }
    }
    res.sendStatus(200)
  } catch (error) {
    logger.error({ type: 'STRIPE_WEBHOOK_FAILED', message: error.message })
    res.status(400).send('Invalid Stripe webhook')
  }
}

router.handleWebhook = handleWebhook
router.applyVerifiedSession = applyVerifiedOrderSession
router.applySellerActivationSession = applySellerActivationSession
router.applyHomepagePromotionSession = applyHomepagePromotionSession
router.applySellerSubscription = applySellerSubscription
router.applySellerSubscriptionSession = applySellerSubscriptionSession
router.applyIdentityVerificationSession = applyIdentityVerificationSession

module.exports = router
