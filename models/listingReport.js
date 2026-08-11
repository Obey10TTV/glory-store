const mongoose = require('mongoose')

const listingReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason: {
    type: String,
    enum: ['counterfeit', 'unsafe_product', 'misleading_listing', 'suspected_scam', 'prohibited_item', 'stolen_content', 'other'],
    required: true
  },
  detail: { type: String, trim: true, maxlength: 1200, default: '' },
  status: {
    type: String,
    enum: ['received', 'in_review', 'actioned', 'dismissed'],
    default: 'received',
    index: true
  },
  adminNote: { type: String, trim: true, maxlength: 1200, default: '', select: false },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true })

listingReportSchema.index({ reporter: 1, listing: 1 }, { unique: true })
listingReportSchema.index({ status: 1, createdAt: -1 })

module.exports = mongoose.model('ListingReport', listingReportSchema)
