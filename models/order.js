const mongoose = require('mongoose')

const orderItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  image: { type: String, required: true },
  price: { type: Number, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  variantId: { type: String, default: '' },
  variantName: { type: String, default: '' },
  fulfillmentStatus: {
    type: String,
    enum: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
    default: 'Processing'
  },
  trackingNumber: { type: String, trim: true, maxlength: 120, default: '' },
  shippedAt: Date,
  deliveredAt: Date
})

const orderSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderItems: [orderItemSchema],
  idempotencyKey: { type: String, trim: true },
  shippingAddress: {
    fullName: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    phone: { type: String, required: true }
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['Paystack', 'PayOnDelivery', 'Crypto']
  },
  paymentResult: {
    id: String,
    status: String,
    update_time: String,
    reference: String
  },
  paymentReference: { type: String, trim: true, index: true, sparse: true },
  itemsPrice: { type: Number, required: true, default: 0 },
  shippingPrice: { type: Number, required: true, default: 0 },
  totalPrice: { type: Number, required: true, default: 0 },
  isPaid: { type: Boolean, required: true, default: false },
  paidAt: Date,
  isDelivered: { type: Boolean, required: true, default: false },
  deliveredAt: Date,
  status: {
    type: String,
    required: true,
    default: 'Pending',
    enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'CancellationRequested', 'Cancelled']
  },
  stockReserved: { type: Boolean, default: false },
  reservationExpiresAt: Date,
  inventoryReleasedAt: Date,
  cancellationRequestedAt: Date,
  cancellationReason: { type: String, trim: true, maxlength: 500, default: '' },
  cancelledAt: Date
}, { timestamps: true })

orderSchema.index({ buyer: 1, idempotencyKey: 1 }, { unique: true, sparse: true })
orderSchema.index({ 'orderItems.seller': 1, createdAt: -1 })

module.exports = mongoose.model('Order', orderSchema)
