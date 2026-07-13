const mongoose = require('mongoose')

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, trim: true, maxlength: 100, index: true },
  entityType: {
    type: String,
    required: true,
    enum: ['order', 'product', 'user', 'seller', 'document', 'privacy']
  },
  entityId: { type: String, required: true, trim: true, maxlength: 100, index: true },
  summary: { type: String, required: true, trim: true, maxlength: 500 },
  requestId: { type: String, trim: true, maxlength: 100, default: '' }
}, { timestamps: true })

auditLogSchema.index({ createdAt: -1 })

module.exports = mongoose.model('AuditLog', auditLogSchema)
