const test = require('node:test')
const assert = require('node:assert/strict')
const {
  aggregateOrderStatus,
  calculateSellerAllocations,
  calculateTotals,
  markOrderPaid,
  recordConfirmedRefund
} = require('../services/orderService')

test('checkout totals are calculated from authoritative line items', () => {
  assert.deepEqual(calculateTotals([{ price: 12.5, quantity: 2 }]), {
    itemsPrice: 25,
    shippingPrice: 4.95,
    totalPrice: 29.95
  })
  assert.deepEqual(calculateTotals([{ price: 37.5, quantity: 2 }]), {
    itemsPrice: 75,
    shippingPrice: 0,
    totalPrice: 75
  })
})

test('international delivery uses the global rate and threshold', () => {
  assert.deepEqual(calculateTotals([{ price: 25, quantity: 2 }], 'Nigeria'), {
    itemsPrice: 50,
    shippingPrice: 14.95,
    totalPrice: 64.95
  })
  assert.deepEqual(calculateTotals([{ price: 75, quantity: 2 }], 'United States'), {
    itemsPrice: 150,
    shippingPrice: 0,
    totalPrice: 150
  })
})

test('multi-seller totals allocate every penny and retain the configured commission', () => {
  const allocations = calculateSellerAllocations([
    { seller: 'seller-a', price: 10, quantity: 1 },
    { seller: 'seller-b', price: 15, quantity: 2 }
  ], 4.95, 1000)

  assert.deepEqual(allocations, [
    {
      seller: 'seller-a',
      paymentMethod: 'card',
      itemSubtotalPence: 1000,
      shippingPence: 124,
      grossPence: 1124,
      platformFeePence: 100,
      sellerNetPence: 1024,
      payoutStatus: 'pending'
    },
    {
      seller: 'seller-b',
      paymentMethod: 'card',
      itemSubtotalPence: 3000,
      shippingPence: 371,
      grossPence: 3371,
      platformFeePence: 300,
      sellerNetPence: 3071,
      payoutStatus: 'pending'
    }
  ])
  assert.equal(allocations.reduce((sum, entry) => sum + entry.grossPence, 0), 4495)
  assert.equal(allocations.reduce((sum, entry) => sum + entry.platformFeePence, 0), 400)
  assert.equal(allocations.reduce((sum, entry) => sum + entry.sellerNetPence, 0), 4095)
})

test('allocation rounding is deterministic when a penny cannot be divided evenly', () => {
  const allocations = calculateSellerAllocations([
    { seller: 'seller-b', price: 1, quantity: 1 },
    { seller: 'seller-a', price: 1, quantity: 1 },
    { seller: 'seller-c', price: 1, quantity: 1 }
  ], 0.01, 0)

  assert.deepEqual(
    allocations.map(entry => [entry.seller, entry.shippingPence]),
    [['seller-a', 1], ['seller-b', 0], ['seller-c', 0]]
  )
})

test('payment updates are idempotent', () => {
  const order = { isPaid: false, paymentResult: {} }
  assert.equal(markOrderPaid(order, { id: '1', status: 'success', reference: 'ref-1' }), true)
  assert.equal(markOrderPaid(order, { id: '2', status: 'success', reference: 'ref-2' }), false)
  assert.equal(order.paymentReference, 'ref-1')
})

test('line-item fulfillment rolls up to the order', () => {
  const order = {
    isPaid: true,
    status: 'Processing',
    orderItems: [{ fulfillmentStatus: 'Shipped' }, { fulfillmentStatus: 'Processing' }]
  }
  aggregateOrderStatus(order)
  assert.equal(order.status, 'Shipped')
  order.orderItems[1].fulfillmentStatus = 'Delivered'
  order.orderItems[0].fulfillmentStatus = 'Delivered'
  aggregateOrderStatus(order)
  assert.equal(order.status, 'Delivered')
  assert.equal(order.isDelivered, true)
})

test('confirmed refunds cannot exceed the remaining paid value', () => {
  const order = {
    isPaid: true,
    totalPrice: 100,
    refundedAmount: 0,
    refundStatus: 'None',
    refunds: []
  }
  assert.equal(recordConfirmedRefund(order, {
    amount: 35,
    providerReference: 'refund-001',
    reason: 'Damaged item',
    recordedBy: 'admin-id'
  }), 'PartiallyRefunded')
  assert.equal(order.refundedAmount, 35)
  assert.throws(() => recordConfirmedRefund(order, {
    amount: 66,
    providerReference: 'refund-002',
    recordedBy: 'admin-id'
  }), /remaining paid order value/)
})
