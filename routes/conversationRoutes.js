const express = require('express')
const mongoose = require('mongoose')
const Conversation = require('../models/conversation')
const Product = require('../models/product')
const { protect } = require('../middleware/auth')
const {
  conversationLimiter,
  validateConversationStart,
  validateConversationMessage,
  handleValidationErrors
} = require('../middleware/security')

const router = express.Router()

const populateConversation = (query) => query
  .populate('listing', 'name image price category approvalStatus')
  .populate('buyer', 'name')
  .populate('seller', 'name sellerProfile.storeName sellerProfile.verificationStatus')
  .populate('messages.sender', 'name')

const isParticipant = (conversation, userId) => (
  String(conversation.buyer) === String(userId) || String(conversation.seller) === String(userId)
)

const safeConversation = (conversation, userId) => {
  const payload = conversation.toObject ? conversation.toObject() : conversation
  const isSeller = String(payload.seller?._id || payload.seller) === String(userId)
  return {
    ...payload,
    participantRole: isSeller ? 'seller' : 'buyer'
  }
}

router.post('/', protect, conversationLimiter, validateConversationStart, handleValidationErrors, async (req, res) => {
  try {
    const { listingId, message } = req.body
    if (!mongoose.isValidObjectId(listingId)) {
      return res.status(400).json({ message: 'Choose a valid listing.' })
    }
    if (req.user.isEmailVerified === false) {
      return res.status(403).json({ message: 'Verify your email before contacting a seller.' })
    }

    const listing = await Product.findOne({ _id: listingId, approvalStatus: 'approved' })
    if (!listing || !listing.seller) {
      return res.status(404).json({ message: 'This listing is no longer available.' })
    }
    if (String(listing.seller) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot contact yourself about your own listing.' })
    }

    let conversation = await Conversation.findOne({
      listing: listing._id,
      buyer: req.user._id,
      seller: listing.seller
    })

    if (conversation?.status === 'blocked') {
      return res.status(403).json({ message: 'This conversation is not available.' })
    }

    if (conversation) {
      conversation.messages.push({ sender: req.user._id, body: message })
      conversation.status = 'open'
      conversation.lastMessageAt = new Date()
      conversation.buyerLastReadAt = new Date()
    } else {
      conversation = new Conversation({
        listing: listing._id,
        buyer: req.user._id,
        seller: listing.seller,
        messages: [{ sender: req.user._id, body: message }],
        buyerLastReadAt: new Date(),
        lastMessageAt: new Date()
      })
    }

    await conversation.save()
    const populated = await populateConversation(Conversation.findById(conversation._id))
    res.status(201).json(safeConversation(populated, req.user._id))
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'A conversation is already being opened. Please try again.' })
    }
    res.status(500).json({ message: 'Unable to start this conversation.' })
  }
})

router.get('/', protect, async (req, res) => {
  try {
    const conversations = await populateConversation(
      Conversation.find({ $or: [{ buyer: req.user._id }, { seller: req.user._id }] })
        .sort({ lastMessageAt: -1 })
        .limit(100)
    )
    const markedRead = conversations.map((conversation) => {
      if (String(conversation.buyer) === String(req.user._id)) conversation.buyerLastReadAt = new Date()
      if (String(conversation.seller) === String(req.user._id)) conversation.sellerLastReadAt = new Date()
      return conversation
    })
    await Promise.all(markedRead.map(conversation => conversation.save()))
    res.json(markedRead.map(conversation => safeConversation(conversation, req.user._id)))
  } catch (error) {
    res.status(500).json({ message: 'Unable to load conversations.' })
  }
})

router.get('/:id', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
    const conversation = await populateConversation(Conversation.findById(req.params.id))
    if (!conversation || !isParticipant(conversation, req.user._id)) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
    if (String(conversation.buyer) === String(req.user._id)) conversation.buyerLastReadAt = new Date()
    if (String(conversation.seller) === String(req.user._id)) conversation.sellerLastReadAt = new Date()
    await conversation.save()
    res.json(safeConversation(conversation, req.user._id))
  } catch (error) {
    res.status(500).json({ message: 'Unable to load this conversation.' })
  }
})

router.post('/:id/messages', protect, conversationLimiter, validateConversationMessage, handleValidationErrors, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !isParticipant(conversation, req.user._id)) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
    if (conversation.status === 'blocked') {
      return res.status(403).json({ message: 'This conversation is not available.' })
    }

    conversation.messages.push({ sender: req.user._id, body: req.body.message })
    conversation.status = 'open'
    conversation.lastMessageAt = new Date()
    if (String(conversation.buyer) === String(req.user._id)) conversation.buyerLastReadAt = new Date()
    if (String(conversation.seller) === String(req.user._id)) conversation.sellerLastReadAt = new Date()
    await conversation.save()

    const populated = await populateConversation(Conversation.findById(conversation._id))
    res.status(201).json(safeConversation(populated, req.user._id))
  } catch (error) {
    res.status(500).json({ message: 'Unable to send your message.' })
  }
})

router.patch('/:id/close', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
    const conversation = await Conversation.findById(req.params.id)
    if (!conversation || !isParticipant(conversation, req.user._id)) {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
    conversation.status = 'closed'
    await conversation.save()
    const populated = await populateConversation(Conversation.findById(conversation._id))
    res.json(safeConversation(populated, req.user._id))
  } catch (error) {
    res.status(500).json({ message: 'Unable to close this conversation.' })
  }
})

module.exports = router
