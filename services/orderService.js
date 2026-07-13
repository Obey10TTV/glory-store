const Product = require('../models/product')

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

const calculateTotals = (items) => {
  const itemsPrice = roundMoney(items.reduce((sum, item) => sum + item.price * item.quantity, 0))
  const shippingPrice = itemsPrice >= 75 ? 0 : 8
  return { itemsPrice, shippingPrice, totalPrice: roundMoney(itemsPrice + shippingPrice) }
}

const reserveOrderItems = async (requestedItems, session) => {
  const verifiedItems = []

  for (const requested of requestedItems) {
    const quantity = Number(requested.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw Object.assign(new Error('Invalid order quantity'), { statusCode: 400 })
    }

    const product = await Product.findOne({
      _id: requested.product,
      approvalStatus: 'approved'
    }).session(session)

    if (!product || !product.seller) {
      throw Object.assign(new Error('One or more products are unavailable'), { statusCode: 400 })
    }

    let variant
    if (product.variants.length > 0) {
      variant = requested.variantId ? product.variants.id(requested.variantId) : null
      if (!variant) {
        throw Object.assign(new Error(`Choose an available option for ${product.name}`), { statusCode: 400 })
      }
      if (variant.countInStock < quantity) {
        throw Object.assign(new Error(`${product.name} (${variant.name}) is unavailable in that quantity`), { statusCode: 409 })
      }
      variant.countInStock -= quantity
      product.countInStock = product.variants.reduce((sum, item) => sum + item.countInStock, 0)
    } else {
      if (product.countInStock < quantity) {
        throw Object.assign(new Error(`${product.name} is unavailable in that quantity`), { statusCode: 409 })
      }
      product.countInStock -= quantity
    }

    await product.save({ session })
    verifiedItems.push({
      name: product.name,
      quantity,
      image: variant?.image || product.image,
      price: Number(variant?.price || product.price),
      product: product._id,
      seller: product.seller,
      variantId: variant?._id?.toString() || '',
      variantName: variant?.name || '',
      fulfillmentStatus: 'Processing'
    })
  }

  return verifiedItems
}

const releaseOrderInventory = async (order, session) => {
  if (!order.stockReserved || order.inventoryReleasedAt) return

  for (const item of order.orderItems) {
    const product = await Product.findById(item.product).session(session)
    if (!product) continue
    if (item.variantId) {
      const variant = product.variants.id(item.variantId)
      if (variant) {
        variant.countInStock += item.quantity
        product.countInStock = product.variants.reduce((sum, entry) => sum + entry.countInStock, 0)
      }
    } else {
      product.countInStock += item.quantity
    }
    await product.save({ session })
  }

  order.stockReserved = false
  order.inventoryReleasedAt = new Date()
}

const aggregateOrderStatus = (order) => {
  const statuses = order.orderItems.map((item) => item.fulfillmentStatus)
  if (statuses.length > 0 && statuses.every((status) => status === 'Delivered')) {
    order.status = 'Delivered'
    order.isDelivered = true
    order.deliveredAt = order.deliveredAt || new Date()
  } else if (statuses.some((status) => status === 'Shipped' || status === 'Delivered')) {
    order.status = 'Shipped'
  } else if (order.isPaid || order.paymentMethod === 'PayOnDelivery') {
    order.status = 'Processing'
  }
}

const markOrderPaid = (order, payment) => {
  if (order.isPaid) return false
  order.isPaid = true
  order.paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date()
  order.status = 'Processing'
  order.paymentReference = payment.reference
  order.paymentResult = {
    id: payment.id,
    status: payment.status,
    reference: payment.reference,
    update_time: payment.paidAt
  }
  return true
}

const recordConfirmedRefund = (order, { amount, providerReference, reason, recordedBy }) => {
  const numericAmount = roundMoney(amount)
  const remaining = roundMoney(Number(order.totalPrice) - Number(order.refundedAmount || 0))
  if (!order.isPaid) throw Object.assign(new Error('Only paid orders can be refunded'), { statusCode: 400 })
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > remaining) {
    throw Object.assign(new Error('Refund amount exceeds the remaining paid order value'), { statusCode: 400 })
  }
  if (String(providerReference || '').trim().length < 3) {
    throw Object.assign(new Error('A confirmed provider refund reference is required'), { statusCode: 400 })
  }
  order.refunds.push({
    amount: numericAmount,
    providerReference: String(providerReference).trim(),
    reason: String(reason || '').trim(),
    recordedBy
  })
  order.refundedAmount = roundMoney(Number(order.refundedAmount || 0) + numericAmount)
  order.refundStatus = order.refundedAmount >= Number(order.totalPrice) ? 'Refunded' : 'PartiallyRefunded'
  return order.refundStatus
}

module.exports = {
  roundMoney,
  calculateTotals,
  reserveOrderItems,
  releaseOrderInventory,
  aggregateOrderStatus,
  markOrderPaid,
  recordConfirmedRefund
}
