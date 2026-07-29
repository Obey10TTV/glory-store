const Product = require('../models/product')
const User = require('../models/user')
const {
  getMarketplaceConfig,
  normalizePaymentMethods,
  orderValueToMethodCode
} = require('./marketplaceService')

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const toPence = (value) => Math.round((Number(value) + Number.EPSILON) * 100)

const isUnitedKingdom = (country = '') => (
  ['united kingdom', 'uk', 'great britain', 'gb'].includes(String(country).trim().toLowerCase())
)

const calculateTotals = (items, country = 'United Kingdom') => {
  const itemsPrice = roundMoney(items.reduce((sum, item) => sum + item.price * item.quantity, 0))
  const ukDestination = isUnitedKingdom(country)
  const freeShippingThreshold = ukDestination ? 75 : 150
  const shippingPrice = itemsPrice >= freeShippingThreshold ? 0 : (ukDestination ? 4.95 : 14.95)
  return { itemsPrice, shippingPrice, totalPrice: roundMoney(itemsPrice + shippingPrice) }
}

const allocateProportionally = (totalPence, weightedEntries) => {
  if (totalPence <= 0 || weightedEntries.length === 0) {
    return new Map(weightedEntries.map(entry => [entry.key, 0]))
  }

  const totalWeight = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0)
  if (totalWeight <= 0) {
    const evenShare = Math.floor(totalPence / weightedEntries.length)
    let remainder = totalPence - (evenShare * weightedEntries.length)
    return new Map(weightedEntries.map(entry => {
      const share = evenShare + (remainder-- > 0 ? 1 : 0)
      return [entry.key, share]
    }))
  }

  const shares = weightedEntries.map(entry => ({
    ...entry,
    share: Math.floor((totalPence * entry.weight) / totalWeight)
  }))
  let remainder = totalPence - shares.reduce((sum, entry) => sum + entry.share, 0)
  shares
    .sort((a, b) => a.key.localeCompare(b.key))
    .forEach(entry => {
      if (remainder > 0) {
        entry.share += 1
        remainder -= 1
      }
    })
  return new Map(shares.map(entry => [entry.key, entry.share]))
}

const calculateSellerAllocations = (
  items,
  shippingPrice,
  commissionBps,
  paymentMethod = 'card'
) => {
  const grouped = new Map()

  items.forEach(item => {
    const seller = String(item.seller?._id || item.seller)
    const itemValuePence = toPence(item.price) * Number(item.quantity)
    grouped.set(seller, (grouped.get(seller) || 0) + itemValuePence)
  })

  const weightedEntries = [...grouped.entries()].map(([key, weight]) => ({ key, weight }))
  const shippingShares = allocateProportionally(toPence(shippingPrice), weightedEntries)

  return weightedEntries
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ key: seller, weight: itemSubtotalPence }) => {
      const shippingPence = shippingShares.get(seller) || 0
      const platformFeePence = Math.round((itemSubtotalPence * commissionBps) / 10000)
      const grossPence = itemSubtotalPence + shippingPence
      return {
        seller,
        paymentMethod,
        itemSubtotalPence,
        shippingPence,
        grossPence,
        platformFeePence,
        sellerNetPence: Math.max(0, grossPence - platformFeePence),
        payoutStatus: 'pending'
      }
    })
}

const getSellerPaymentMap = async (sellerIds, session) => {
  const query = User.find({ _id: { $in: sellerIds } })
    .select('_id isAdmin sellerProfile.acceptedPaymentMethods sellerProfile.activationStatus sellerProfile.payoutStatus')
  if (session) query.session(session)
  const sellers = await query.lean()
  return new Map(sellers.map(seller => [
    String(seller._id),
    { ...(seller.sellerProfile || {}), isAdmin: Boolean(seller.isAdmin) }
  ]))
}

const getCompatiblePaymentMethods = async (items, session) => {
  const sellerIds = [...new Set(items.map(item => String(item.seller?._id || item.seller)))]
  const sellerPaymentMap = await getSellerPaymentMap(sellerIds, session)
  const config = getMarketplaceConfig()
  const enabledMethods = new Set(
    config.paymentMethods.filter(method => method.enabled).map(method => method.code)
  )

  let compatible = null
  const sellerSummaries = sellerIds.map(sellerId => {
    const seller = sellerPaymentMap.get(sellerId) || {}
    const sellerItems = items.filter(item => String(item.seller?._id || item.seller) === sellerId)
    const sellerDefaults = normalizePaymentMethods(seller.acceptedPaymentMethods)
    const itemMethods = sellerItems.map(item => (
      normalizePaymentMethods(item.acceptedPaymentMethods, sellerDefaults)
    ))
    const requestedMethods = itemMethods.reduce(
      (common, methods) => common.filter(method => methods.includes(method)),
      sellerDefaults
    )
    const activationReady = seller.isAdmin
      || !config.sellerActivationRequired
      || ['paid', 'waived'].includes(seller.activationStatus)
    const payoutReady = seller.isAdmin || seller.payoutStatus === 'active'
    const acceptedMethods = activationReady && payoutReady ? requestedMethods : []

    compatible = compatible === null
      ? [...acceptedMethods]
      : compatible.filter(method => acceptedMethods.includes(method))

    return {
      sellerId,
      acceptedMethods,
      readyForCheckout: activationReady && payoutReady,
      activationStatus: seller.activationStatus || 'unpaid',
      payoutStatus: seller.payoutStatus || 'not_started'
    }
  })

  return {
    compatibleMethods: (compatible || []).filter(method => enabledMethods.has(method)),
    sellerSummaries,
    availableMethods: config.paymentMethods
  }
}

const assertOrderPaymentAllowed = async (items, paymentMethod, session) => {
  const methodCode = orderValueToMethodCode(paymentMethod)
  const compatibility = await getCompatiblePaymentMethods(items, session)
  if (!methodCode || !compatibility.compatibleMethods.includes(methodCode)) {
    throw Object.assign(
      new Error('The selected payment method is not available for every item in this basket'),
      { statusCode: 409 }
    )
  }
  return methodCode
}

const previewOrderItems = async (requestedItems) => {
  if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 100) {
    throw Object.assign(new Error('Order must contain between 1 and 100 items'), { statusCode: 400 })
  }

  const items = []
  for (const requested of requestedItems) {
    const quantity = Number(requested.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw Object.assign(new Error('Invalid order quantity'), { statusCode: 400 })
    }

    const product = await Product.findOne({
      _id: requested.product,
      approvalStatus: 'approved'
    }).lean()
    if (!product || !product.seller) {
      throw Object.assign(new Error('One or more products are unavailable'), { statusCode: 400 })
    }

    const variant = product.variants?.length
      ? product.variants.find(entry => String(entry._id) === String(requested.variantId || ''))
      : null
    if (product.variants?.length && !variant) {
      throw Object.assign(new Error(`Choose an available option for ${product.name}`), { statusCode: 400 })
    }
    const availableStock = variant ? variant.countInStock : product.countInStock
    if (availableStock < quantity) {
      throw Object.assign(new Error(`${product.name} is unavailable in that quantity`), { statusCode: 409 })
    }

    items.push({
      name: product.name,
      quantity,
      image: variant?.image || product.image,
      price: Number(variant?.price || product.price),
      product: product._id,
      seller: product.seller,
      acceptedPaymentMethods: product.acceptedPaymentMethods || []
    })
  }
  return items
}

const getCheckoutQuote = async (requestedItems, country = 'United Kingdom') => {
  const items = await previewOrderItems(requestedItems)
  const totals = calculateTotals(items, country)
  const compatibility = await getCompatiblePaymentMethods(items)
  const config = getMarketplaceConfig()

  return {
    currency: config.currency,
    ...totals,
    itemsPricePence: toPence(totals.itemsPrice),
    shippingPricePence: toPence(totals.shippingPrice),
    totalPricePence: toPence(totals.totalPrice),
    compatibleMethods: compatibility.compatibleMethods,
    availableMethods: compatibility.availableMethods,
    sellerCount: compatibility.sellerSummaries.length
  }
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
      acceptedPaymentMethods: product.acceptedPaymentMethods || [],
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
  toPence,
  isUnitedKingdom,
  calculateTotals,
  calculateSellerAllocations,
  getCompatiblePaymentMethods,
  assertOrderPaymentAllowed,
  getCheckoutQuote,
  reserveOrderItems,
  releaseOrderInventory,
  aggregateOrderStatus,
  markOrderPaid,
  recordConfirmedRefund
}
