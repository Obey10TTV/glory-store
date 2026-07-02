const express = require('express')
const router = express.Router()
const https = require('https')
const { protect } = require('../middleware/auth')
const Order = require('../models/order')

const configuredClientOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.CORS_ORIGINS
]
  .flatMap((value) => (value || '').split(','))
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean)

const getClientOrigin = () => {
  if (configuredClientOrigins.length > 0) {
    return configuredClientOrigins[0]
  }

  return process.env.NODE_ENV === 'production'
    ? 'https://glory-frontend-gray.vercel.app'
    : 'http://localhost:3000'
}

const canAccessOrder = (order, user) => {
  const buyerId = order.buyer?._id || order.buyer
  return user.isAdmin || buyerId?.toString() === user._id.toString()
}

// INITIALIZE PAYMENT - POST /api/paystack/initialize
router.post('/initialize', protect, async (req, res) => {
  try {
    const { email, orderId } = req.body

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ message: 'Payment provider is not configured' })
    }

    const order = await Order.findById(orderId)

    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to pay this order' })
    }

    const amountInKobo = Math.round(Number(order.totalPrice) * 100)

    if (!Number.isFinite(amountInKobo) || amountInKobo <= 0) {
      return res.status(400).json({ message: 'Order total is invalid' })
    }

    const params = JSON.stringify({
      email: email || req.user.email,
      amount: amountInKobo,
      metadata: {
        orderId: order._id.toString(),
        userId: req.user.id
      },
      callback_url: `${getClientOrigin()}/payment/verify`
    })

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/transaction/initialize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    }

    const paystackReq = https.request(options, (paystackRes) => {
      let data = ''
      paystackRes.on('data', (chunk) => { data += chunk })
      paystackRes.on('end', () => {
        let response
        try {
          response = JSON.parse(data)
        } catch (error) {
          return res.status(502).json({ message: 'Invalid payment provider response' })
        }
        res.json(response)
      })
    })

    paystackReq.on('error', (error) => {
      res.status(500).json({ message: error.message })
    })

    paystackReq.write(params)
    paystackReq.end()

  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// VERIFY PAYMENT - GET /api/paystack/verify/:reference
router.get('/verify/:reference', protect, async (req, res) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({ message: 'Payment provider is not configured' })
    }

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/transaction/verify/${req.params.reference}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    }

    const paystackReq = https.request(options, (paystackRes) => {
      let data = ''
      paystackRes.on('data', (chunk) => { data += chunk })
      paystackRes.on('end', async () => {
        let response
        try {
          response = JSON.parse(data)
        } catch (error) {
          return res.status(502).json({ message: 'Invalid payment provider response' })
        }

        if (response.data?.status === 'success') {
          const orderId = response.data.metadata.orderId

          // Update order to paid
          const order = await Order.findById(orderId)
          if (order) {
            if (!canAccessOrder(order, req.user)) {
              return res.status(403).json({ message: 'Not authorized to verify this order' })
            }

            order.isPaid = true
            order.paidAt = Date.now()
            order.status = 'Processing'
            order.paymentResult = {
              id: response.data.id,
              status: response.data.status,
              reference: response.data.reference,
              update_time: response.data.paid_at
            }
            await order.save()
          }
        }

        res.json(response)
      })
    })

    paystackReq.on('error', (error) => {
      res.status(500).json({ message: error.message })
    })

    paystackReq.end()

  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
