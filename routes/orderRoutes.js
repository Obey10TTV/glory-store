const express = require('express')
const mongoose = require('mongoose')
const router = express.Router()
const Order = require('../models/order')
const { protect, admin } = require('../middleware/auth')
const { validateOrder, handleValidationErrors } = require('../middleware/security')
const {
  aggregateOrderStatus,
  calculateTotals,
  markOrderPaid,
  releaseOrderInventory,
  reserveOrderItems
} = require('../services/orderService')
const { sendOrderStatusEmail } = require('../utils/email')

const canViewOrder = (order, user) => {
  const buyerId = order.buyer?._id || order.buyer
  const isOrderSeller = order.orderItems?.some(
    (item) => (item.seller?._id || item.seller)?.toString() === user._id.toString()
  )
  return user.isAdmin || buyerId?.toString() === user._id.toString() || isOrderSeller
}

const handleError = (res, error) => {
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : 'Unable to complete the order request'
  })
}

// CREATE ORDER WITH ATOMIC STOCK RESERVATION
router.post('/', protect, validateOrder, handleValidationErrors, async (req, res) => {
  const idempotencyKey = String(req.get('idempotency-key') || '').trim()
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ message: 'A valid idempotency key is required' })
  }

  const existing = await Order.findOne({ buyer: req.user._id, idempotencyKey })
  if (existing) return res.json(existing)

  const session = await mongoose.startSession()
  let createdOrder
  try {
    await session.withTransaction(async () => {
      const verifiedItems = await reserveOrderItems(req.body.orderItems, session)
      const totals = calculateTotals(verifiedItems)
      const [order] = await Order.create([{
        buyer: req.user._id,
        orderItems: verifiedItems,
        idempotencyKey,
        shippingAddress: req.body.shippingAddress,
        paymentMethod: req.body.paymentMethod,
        ...totals,
        status: req.body.paymentMethod === 'PayOnDelivery' ? 'Processing' : 'Pending',
        stockReserved: true,
        reservationExpiresAt: req.body.paymentMethod === 'Paystack'
          ? new Date(Date.now() + 30 * 60 * 1000)
          : undefined
      }], { session })
      createdOrder = order
    })
    res.status(201).json(createdOrder)
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await Order.findOne({ buyer: req.user._id, idempotencyKey })
      if (duplicate) return res.json(duplicate)
    }
    handleError(res, error)
  } finally {
    await session.endSession()
  }
})

router.get('/myorders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id })
      .sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/seller', protect, async (req, res) => {
  try {
    if (!req.user.isSeller && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized as seller' })
    }
    const query = req.user.isAdmin ? {} : { 'orderItems.seller': req.user._id }
    const orders = await Order.find(query)
      .populate('buyer', 'name email')
      .sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/:id/fulfillment', protect, async (req, res) => {
  try {
    if (!req.user.isSeller && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized as seller' })
    }
    const { itemId, status, trackingNumber = '' } = req.body
    if (!['Shipped', 'Delivered'].includes(status)) {
      return res.status(400).json({ message: 'Invalid fulfillment status' })
    }
    if (status === 'Shipped' && String(trackingNumber).trim().length < 3) {
      return res.status(400).json({ message: 'A tracking number is required when shipping an order' })
    }

    const order = await Order.findById(req.params.id).populate('buyer', 'name email')
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!order.isPaid && order.paymentMethod !== 'PayOnDelivery') {
      return res.status(400).json({ message: 'Payment must be confirmed before fulfillment' })
    }
    if (['Cancelled', 'CancellationRequested'].includes(order.status)) {
      return res.status(400).json({ message: 'This order cannot be fulfilled while cancellation is active' })
    }

    const item = order.orderItems.id(itemId)
    if (!item) return res.status(404).json({ message: 'Order item not found' })
    if (!req.user.isAdmin && item.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this item' })
    }

    item.fulfillmentStatus = status
    if (status === 'Shipped') {
      item.trackingNumber = String(trackingNumber).trim()
      item.shippedAt = new Date()
    } else {
      item.deliveredAt = new Date()
    }
    aggregateOrderStatus(order)
    await order.save()
    await sendOrderStatusEmail({ order, status, trackingNumber: item.trackingNumber })
    res.json(order)
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/:id/cancel', protect, async (req, res) => {
  const session = await mongoose.startSession()
  try {
    let updatedOrder
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session)
      if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
      const buyerId = order.buyer?._id || order.buyer
      if (!req.user.isAdmin && buyerId.toString() !== req.user._id.toString()) {
        throw Object.assign(new Error('Not authorized to cancel this order'), { statusCode: 403 })
      }
      if (['Shipped', 'Delivered', 'Cancelled'].includes(order.status)) {
        throw Object.assign(new Error('This order can no longer be cancelled online'), { statusCode: 400 })
      }

      order.cancellationReason = String(req.body.reason || '').trim().slice(0, 500)
      if (order.isPaid) {
        order.status = 'CancellationRequested'
        order.cancellationRequestedAt = new Date()
      } else {
        await releaseOrderInventory(order, session)
        order.status = 'Cancelled'
        order.cancelledAt = new Date()
        order.orderItems.forEach((item) => { item.fulfillmentStatus = 'Cancelled' })
      }
      updatedOrder = await order.save({ session })
    })
    res.json(updatedOrder)
  } catch (error) {
    handleError(res, error)
  } finally {
    await session.endSession()
  }
})

router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('buyer', 'name email')
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!canViewOrder(order, req.user)) {
      return res.status(403).json({ message: 'Not authorized to view this order' })
    }
    res.json(order)
  } catch (error) {
    handleError(res, error)
  }
})

router.put('/:id/pay', protect, admin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    markOrderPaid(order, {
      id: req.body.id,
      status: req.body.status,
      reference: req.body.reference,
      paidAt: req.body.update_time
    })
    await order.save()
    res.json(order)
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/', protect, admin, async (req, res) => {
  try {
    const orders = await Order.find({}).populate('buyer', 'name email').sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    handleError(res, error)
  }
})

module.exports = router
