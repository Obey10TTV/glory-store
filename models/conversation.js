const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true, maxlength: 1200 },
  sentAt: { type: Date, default: Date.now }
}, { _id: true })

const conversationSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: {
    type: String,
    enum: ['open', 'closed', 'blocked'],
    default: 'open',
    index: true
  },
  messages: { type: [messageSchema], default: [] },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  buyerLastReadAt: Date,
  sellerLastReadAt: Date
}, { timestamps: true })

conversationSchema.index({ listing: 1, buyer: 1, seller: 1 }, { unique: true })
conversationSchema.index({ seller: 1, status: 1, lastMessageAt: -1 })
conversationSchema.index({ buyer: 1, status: 1, lastMessageAt: -1 })

module.exports = mongoose.model('Conversation', conversationSchema)
