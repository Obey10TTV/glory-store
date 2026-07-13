const test = require('node:test')
const assert = require('node:assert/strict')
const { aggregateOrderStatus, calculateTotals, markOrderPaid, recordConfirmedRefund } = require('../services/orderService')

test('checkout totals are calculated from authoritative line items', () => {
  assert.deepEqual(calculateTotals([{ price: 12.5, quantity: 2 }]), {
    itemsPrice: 25,
    shippingPrice: 8,
    totalPrice: 33
  })
  assert.deepEqual(calculateTotals([{ price: 37.5, quantity: 2 }]), {
    itemsPrice: 75,
    shippingPrice: 0,
    totalPrice: 75
  })
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
