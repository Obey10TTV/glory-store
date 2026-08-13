const mongoose = require('mongoose')

const reviewReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  review: { type: mongoose.Schema.Types.ObjectId, ref: 'Review', required: true, index: true },
  reason: {
    type: String,
    enum: ['suspected_fake', 'conflict_of_interest', 'abusive', 'personal_information', 'irrelevant', 'other'],
    required: true
  },
  detail: { type: String, trim: true, maxlength: 1000, default: '' },
  status: {
    type: String,
    enum: ['received', 'actioned', 'dismissed'],
    default: 'received',
    index: true
  },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true })

reviewReportSchema.index({ reporter: 1, review: 1 }, { unique: true })
reviewReportSchema.index({ status: 1, createdAt: -1 })

module.exports = mongoose.model('ReviewReport', reviewReportSchema)
