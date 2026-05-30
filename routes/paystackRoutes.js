const express = require('express')
const router = express.Router()
const https = require('https')
const { protect } = require('../middleware/auth')
const Order = require('../models/order')

// INITIALIZE PAYMENT - POST /api/paystack/initialize
router.post('/initialize', protect, async (req, res) => {
  try {
    const { email, amount, orderId } = req.body

    const params = JSON.stringify({
      email,
      amount: amount * 100, // Paystack uses kobo so multiply by 100
      metadata: {
        orderId,
        userId: req.user.id
      },
      callback_url: 'http://localhost:3000/payment/verify'
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
        const response = JSON.parse(data)
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
        const response = JSON.parse(data)

        if (response.data.status === 'success') {
          const orderId = response.data.metadata.orderId

          // Update order to paid
          const order = await Order.findById(orderId)
          if (order) {
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