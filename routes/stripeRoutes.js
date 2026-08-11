const express = require('express')
const Stripe = require('stripe')
const router = express.Router()
const { protect } = require('../middleware/auth')
const Order = require('../models/order')
const User = require('../models/user')
const { markOrderPaid } = require('../services/orderService')
const { getMarketplaceConfig } = require('../services/marketplaceService')
const {
  getSellerCommerceStatus,
  transferOrderAllocations,
  updateConnectedAccountStatus
} = require('../services/stripeMarketplaceService')
const { sendOrderStatusEmail } = require('../utils/email')
const { logger } = require('../middleware/logger')

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

const configuredClientOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL
].filter(Boolean)

const getClientOrigin = () => configuredClientOrigins[0]
  || (process.env.NODE_ENV === 'production' ? 'https://glory-ca.vercel.app' : 'http://localhost:3000')

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

const applySellerActivationSession = async (session) => {
  if (session?.payment_status !== 'paid' || session.metadata?.purpose !== 'seller_activation') {
    return null
  }

  const marketplace = getMarketplaceConfig()
  const userId = session.metadata?.userId
  if (!userId) throw Object.assign(new Error('Seller activation metadata is incomplete'), { statusCode: 400 })
  if (
    session.currency !== 'gbp'
    || Number(session.amount_total) !== marketplace.sellerActivationFeePence
  ) {
    throw Object.assign(new Error('Seller activation currency or amount does not match'), { statusCode: 400 })
  }

  const user = await User.findById(userId)
  if (!user?.isSeller) {
    throw Object.assign(new Error('Seller account not found'), { statusCode: 404 })
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
  const marketplace = getMarketplaceConfig()
  res.json({
    enabled: Boolean(stripe),
    currency: marketplace.currency,
    sellerActivationRequired: marketplace.sellerActivationRequired,
    sellerActivationFeePence: marketplace.sellerActivationFeePence,
    platformCommissionBps: marketplace.platformCommissionBps,
    marketplaceMode: marketplace.marketplaceMode,
    directCheckoutEnabled: marketplace.directCheckoutEnabled,
    paymentMethods: marketplace.paymentMethods
  })
})

router.get('/seller/status', protect, async (req, res) => {
  try {
    const marketplace = getMarketplaceConfig()
    const user = await User.findById(req.user._id)
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })

    if (stripe && user.sellerProfile.stripeAccountId) {
      const account = await stripe.accounts.retrieve(user.sellerProfile.stripeAccountId)
      await updateConnectedAccountStatus(user, account)
    }

    res.json({
      ...getSellerCommerceStatus(user, marketplace),
      paymentMethods: marketplace.paymentMethods
    })
  } catch (error) {
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Unable to load seller payment status'
    })
  }
})

router.post('/seller/activation', protect, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ message: 'Seller activation payments are not configured yet' })

    const marketplace = getMarketplaceConfig()
    const user = await User.findById(req.user._id)
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
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
          currency: 'gbp',
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
        userId: user._id.toString()
      },
      payment_intent_data: {
        metadata: {
          purpose: 'seller_activation',
          userId: user._id.toString()
        }
      },
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
      if (session.metadata?.purpose === 'seller_activation') {
        await applySellerActivationSession(session)
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
    res.sendStatus(200)
  } catch (error) {
    logger.error({ type: 'STRIPE_WEBHOOK_FAILED', message: error.message })
    res.status(400).send('Invalid Stripe webhook')
  }
}

router.handleWebhook = handleWebhook
router.applyVerifiedSession = applyVerifiedOrderSession
router.applySellerActivationSession = applySellerActivationSession

module.exports = router
