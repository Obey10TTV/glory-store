const crypto = require('crypto')
const express = require('express')
const https = require('https')
const router = express.Router()
const { protect } = require('../middleware/auth')
const Order = require('../models/order')
const { markOrderPaid } = require('../services/orderService')
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

router.post('/initialize', protect, async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(503).json({ message: 'Payment provider is not configured' })
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
        currency: process.env.PAYSTACK_CURRENCY || 'CAD',
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
      await applyVerifiedPayment(event.data)
    }
    res.sendStatus(200)
  } catch (error) {
    logger.error({ type: 'PAYSTACK_WEBHOOK_FAILED', message: error.message })
    res.sendStatus(500)
  }
}

router.handleWebhook = handleWebhook
module.exports = router
