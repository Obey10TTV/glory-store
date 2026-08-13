const mongoose = require('mongoose')

const reviewSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reviewerName: { type: String, required: true, trim: true, maxlength: 80 },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
  commentHash: { type: String, required: true, select: false },
  verifiedInteraction: { type: Boolean, required: true, default: true },
  status: {
    type: String,
    enum: ['pending', 'published', 'rejected', 'removed'],
    default: 'pending',
    index: true
  },
  riskSignals: {
    type: [{ type: String, maxlength: 80 }],
    default: [],
    select: false
  },
  moderationNote: { type: String, trim: true, maxlength: 1000, default: '', select: false },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  publishedAt: Date,
  reportCount: { type: Number, default: 0, min: 0 },
  lastReportedAt: Date
}, { timestamps: true })

reviewSchema.index({ conversation: 1, reviewer: 1 }, { unique: true })
reviewSchema.index({ listing: 1, status: 1, publishedAt: -1 })
reviewSchema.index({ seller: 1, reviewer: 1, createdAt: -1 })

reviewSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.commentHash
    delete ret.riskSignals
    delete ret.moderationNote
    return ret
  }
})

module.exports = mongoose.model('Review', reviewSchema)
