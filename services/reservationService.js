const mongoose = require('mongoose')
const Order = require('../models/order')
const { releaseOrderInventory } = require('./orderService')
const { logger } = require('../middleware/logger')

const releaseExpiredReservations = async () => {
  if (mongoose.connection.readyState !== 1) return 0
  const expired = await Order.find({
    isPaid: false,
    stockReserved: true,
    status: 'Pending',
    reservationExpiresAt: { $lte: new Date() }
  }).select('_id').limit(25)

  let released = 0
  for (const candidate of expired) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const order = await Order.findById(candidate._id).session(session)
        if (!order || order.isPaid || !order.stockReserved) return
        await releaseOrderInventory(order, session)
        order.status = 'Cancelled'
        order.cancelledAt = new Date()
        order.cancellationReason = 'Checkout reservation expired'
        order.orderItems.forEach((item) => { item.fulfillmentStatus = 'Cancelled' })
        await order.save({ session })
        released += 1
      })
    } catch (error) {
      logger.error({ type: 'RESERVATION_RELEASE_FAILED', orderId: candidate._id, message: error.message })
    } finally {
      await session.endSession()
    }
  }
  return released
}

module.exports = { releaseExpiredReservations }
