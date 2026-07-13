const mongoose = require('mongoose')

const supportNoteSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { type: String, enum: ['buyer', 'seller', 'admin'], required: true },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  visibility: { type: String, enum: ['participants', 'admin'], default: 'participants' },
  createdAt: { type: Date, default: Date.now }
})

const refundSchema = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0.01 },
  providerReference: { type: String, required: true, trim: true, maxlength: 160 },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedAt: { type: Date, default: Date.now }
})

const disputeSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['damaged', 'missing', 'wrong_item', 'not_as_described', 'other'],
    required: true
  },
  message: { type: String, trim: true, maxlength: 1000, required: true },
  status: {
    type: String,
    enum: ['Open', 'UnderReview', 'Resolved', 'Closed'],
    default: 'Open'
  },
  resolution: { type: String, trim: true, maxlength: 1000, default: '' },
  openedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: false })

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
  cancelledAt: Date,
  refundStatus: {
    type: String,
    enum: ['None', 'Requested', 'Processing', 'PartiallyRefunded', 'Refunded', 'Rejected'],
    default: 'None'
  },
  refundedAmount: { type: Number, min: 0, default: 0 },
  refunds: { type: [refundSchema], default: [] },
  dispute: { type: disputeSchema, default: undefined },
  supportNotes: { type: [supportNoteSchema], default: [] }
}, { timestamps: true })

orderSchema.index({ buyer: 1, idempotencyKey: 1 }, { unique: true, sparse: true })
orderSchema.index({ 'orderItems.seller': 1, createdAt: -1 })
orderSchema.index({ 'dispute.status': 1, createdAt: -1 })
orderSchema.index({ refundStatus: 1, createdAt: -1 })

module.exports = mongoose.model('Order', orderSchema)
