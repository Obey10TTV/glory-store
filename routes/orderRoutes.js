const express = require('express')
const router = express.Router()
const Order = require('../models/order')
const { protect } = require('../middleware/auth')


// CREATE ORDER - POST /api/orders
router.post('/', protect, async (req, res) => {
  try {
    const {
      orderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      shippingPrice,
      totalPrice
    } = req.body

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ message: 'No order items' })
    }

    const order = await Order.create({
      buyer: req.user.id,
      orderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      shippingPrice,
      totalPrice
    })

    res.status(201).json(order)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET MY ORDERS - GET /api/orders/myorders
router.get('/myorders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user.id })
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SINGLE ORDER - GET /api/orders/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('buyer', 'name email')
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }
    res.json(order)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// PAY ORDER - PUT /api/orders/:id/pay
router.put('/:id/pay', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    order.isPaid = true
    order.paidAt = Date.now()
    order.status = 'Processing'
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      reference: req.body.reference
    }

    const updatedOrder = await order.save()
    res.json(updatedOrder)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELIVER ORDER - PUT /api/orders/:id/deliver
router.put('/:id/deliver', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    order.isDelivered = true
    order.deliveredAt = Date.now()
    order.status = 'Delivered'

    const updatedOrder = await order.save()
    res.json(updatedOrder)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// CANCEL ORDER - PUT /api/orders/:id/cancel
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (order.status === 'Delivered') {
      return res.status(400).json({ message: 'Cannot cancel a delivered order' })
    }

    order.status = 'Cancelled'
    const updatedOrder = await order.save()
    res.json(updatedOrder)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET ALL ORDERS - Admin only - GET /api/orders
router.get('/', protect, async (req, res) => {
  try {
    const orders = await Order.find({}).populate('buyer', 'name email')
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router