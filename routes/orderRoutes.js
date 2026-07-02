const express = require('express')
const router = express.Router()
const Order = require('../models/order')
const Product = require('../models/product')
const { protect, admin } = require('../middleware/auth')
const {
  validateOrder,
  handleValidationErrors
} = require('../middleware/security')

const canAccessOrder = (order, user) => {
  const buyerId = order.buyer?._id || order.buyer
  return user.isAdmin || buyerId?.toString() === user._id.toString()
}

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

// CREATE ORDER
router.post('/', protect, validateOrder, handleValidationErrors, async (req, res) => {
  try {
    const {
      orderItems, shippingAddress, paymentMethod
    } = req.body

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ message: 'No order items' })
    }

    const productIds = [...new Set(orderItems.map((item) => item.product))]
    const products = await Product.find({ _id: { $in: productIds } })
    const productMap = new Map(products.map((product) => [product._id.toString(), product]))

    if (products.length !== productIds.length) {
      return res.status(400).json({ message: 'One or more products are unavailable' })
    }

    const verifiedOrderItems = []

    for (const item of orderItems) {
      const product = productMap.get(item.product)
      const quantity = Number(item.quantity)

      if (!product || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Invalid order item' })
      }

      if (product.countInStock < quantity) {
        return res.status(400).json({ message: `${product.name} is not available in the requested quantity` })
      }

      verifiedOrderItems.push({
        name: product.name,
        quantity,
        image: product.image,
        price: product.price,
        product: product._id
      })
    }

    const calculatedItemsPrice = roundMoney(
      verifiedOrderItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    )
    const calculatedShippingPrice = calculatedItemsPrice >= 75 ? 0 : 8
    const calculatedTotalPrice = roundMoney(calculatedItemsPrice + calculatedShippingPrice)

    const order = await Order.create({
      buyer: req.user._id,
      orderItems: verifiedOrderItems,
      shippingAddress,
      paymentMethod,
      itemsPrice: calculatedItemsPrice,
      shippingPrice: calculatedShippingPrice,
      totalPrice: calculatedTotalPrice
    })

    res.status(201).json(order)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET MY ORDERS
router.get('/myorders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id })
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SINGLE ORDER
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('buyer', 'name email')
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to view this order' })
    }
    res.json(order)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// PAY ORDER - Admin/manual reconciliation only. Customer card payments use Paystack verification.
router.put('/:id/pay', protect, admin, async (req, res) => {
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

// DELIVER ORDER
router.put('/:id/deliver', protect, admin, async (req, res) => {
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

// CANCEL ORDER
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }

    if (!canAccessOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to cancel this order' })
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

// GET ALL ORDERS - Admin only
router.get('/', protect, admin, async (req, res) => {
  try {
    const orders = await Order.find({}).populate('buyer', 'name email')
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
