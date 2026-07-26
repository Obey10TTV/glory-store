const express = require('express')
const Stripe = require('stripe')
const router = express.Router()
const { protect } = require('../middleware/auth')
const Order = require('../models/order')
const { markOrderPaid } = require('../services/orderService')
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

const applyVerifiedSession = async (session) => {
  if (session?.payment_status !== 'paid') return null

  const orderId = session.metadata?.orderId
  if (!orderId) throw Object.assign(new Error('Payment metadata is incomplete'), { statusCode: 400 })

  const order = await Order.findById(orderId).populate('buyer', 'name email')
  if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })

  const expectedAmount = Math.round(Number(order.totalPrice) * 100)
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
  return order
}

router.get('/status', (req, res) => {
  res.json({ enabled: Boolean(stripe), currency: 'GBP' })
})

router.post('/initialize', protect, async (req, res) => {
  try {
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
    if (!stripe) {
      return res.status(503).json({ message: 'UK card payments are not configured yet' })
    }

    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId)
    const order = await Order.findById(session.metadata?.orderId)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to verify this order' })
    }

    await applyVerifiedSession(session)
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
      await applyVerifiedSession(event.data.object)
    }
    res.sendStatus(200)
  } catch (error) {
    logger.error({ type: 'STRIPE_WEBHOOK_FAILED', message: error.message })
    res.status(400).send('Invalid Stripe webhook')
  }
}

router.handleWebhook = handleWebhook
router.applyVerifiedSession = applyVerifiedSession

module.exports = router
