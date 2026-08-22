const mongoose = require('mongoose')

// Only counters and a date key are retained. Skin concerns and messages are
// intentionally never stored in this model or in the audit log.
const skinGuideUsageSchema = new mongoose.Schema({
  dayKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  scopeKey: { type: String, required: true, maxlength: 80 },
  requestCount: { type: Number, default: 0, min: 0 },
  messageCount: { type: Number, default: 0, min: 0 },
  imageCount: { type: Number, default: 0, min: 0 },
  handoffCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true })

skinGuideUsageSchema.index({ dayKey: 1, scopeKey: 1 }, { unique: true })
skinGuideUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 45 })

module.exports = mongoose.model('SkinGuideUsage', skinGuideUsageSchema)
