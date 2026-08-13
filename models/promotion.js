const mongoose = require('mongoose')

const promotionSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  placement: {
    type: String,
    enum: ['homepage_featured'],
    required: true,
    index: true
  },
  planCode: { type: String, required: true, trim: true, maxlength: 60 },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  baseAmountPence: { type: Number, min: 0, default: 0 },
  discountPence: { type: Number, required: true, min: 0, default: 0 },
  amountPence: { type: Number, required: true, min: 0 },
  sellerPlanCode: {
    type: String,
    enum: ['starter', 'studio', 'scale', 'partner'],
    default: 'starter'
  },
  currency: { type: String, required: true, trim: true, uppercase: true, maxlength: 3 },
  durationDays: { type: Number, required: true, min: 1, max: 31 },
  slotNumber: { type: Number, min: 1, max: 32 },
  status: {
    type: String,
    enum: ['pending_payment', 'active', 'expired', 'failed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },
  paymentReference: { type: String, trim: true, default: '', select: false },
  paymentIntentId: { type: String, trim: true, default: '', select: false },
  startsAt: Date,
  endsAt: Date,
  activatedAt: Date,
  failureReason: { type: String, trim: true, maxlength: 300, default: '' }
}, { timestamps: true })

promotionSchema.index({ placement: 1, status: 1, startsAt: 1, endsAt: 1 })
promotionSchema.index({ seller: 1, listing: 1, status: 1, createdAt: -1 })
promotionSchema.index({ placement: 1, slotNumber: 1 }, { unique: true, sparse: true })

promotionSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.paymentReference
    delete ret.paymentIntentId
    delete ret.failureReason
    return ret
  }
})

module.exports = mongoose.model('Promotion', promotionSchema)
