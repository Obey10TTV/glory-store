const mongoose = require('mongoose')

const promotionSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  marketCode: {
    type: String,
    enum: ['NG', 'GB', 'US', 'CA'],
    default: 'GB',
    required: true,
    index: true
  },
  placement: {
    type: String,
    enum: ['homepage_featured', 'homepage_video'],
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
  creativeType: {
    type: String,
    enum: ['listing', 'video'],
    default: 'listing'
  },
  creativeHeadline: { type: String, trim: true, maxlength: 100, default: '' },
  creativeCopy: { type: String, trim: true, maxlength: 220, default: '' },
  creativeMediaUrl: { type: String, trim: true, maxlength: 600, default: '' },
  creativeCtaLabel: { type: String, trim: true, maxlength: 40, default: 'View product' },
  creativeReviewStatus: {
    type: String,
    enum: ['not_required', 'pending', 'approved', 'rejected'],
    default: 'not_required',
    index: true
  },
  creativeReviewNote: { type: String, trim: true, maxlength: 300, default: '' },
  durationDays: { type: Number, required: true, min: 1, max: 31 },
  slotNumber: { type: Number, min: 1, max: 32 },
  status: {
    type: String,
    enum: ['pending_review', 'approved_for_payment', 'pending_payment', 'active', 'expired', 'failed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },
  paymentProvider: {
    type: String,
    enum: ['stripe', 'paystack'],
    default: 'stripe'
  },
  paymentReference: { type: String, trim: true, default: '', select: false },
  paymentIntentId: { type: String, trim: true, default: '', select: false },
  startsAt: Date,
  endsAt: Date,
  activatedAt: Date,
  failureReason: { type: String, trim: true, maxlength: 300, default: '' }
}, { timestamps: true })

promotionSchema.index({ marketCode: 1, placement: 1, status: 1, startsAt: 1, endsAt: 1 })
promotionSchema.index({ seller: 1, listing: 1, status: 1, createdAt: -1 })
promotionSchema.index({ marketCode: 1, placement: 1, slotNumber: 1 }, { unique: true, sparse: true })

promotionSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.paymentReference
    delete ret.paymentIntentId
    delete ret.failureReason
    delete ret.creativeReviewNote
    return ret
  }
})

module.exports = mongoose.model('Promotion', promotionSchema)
