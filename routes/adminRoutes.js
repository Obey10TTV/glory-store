const express = require('express')
const mongoose = require('mongoose')
const router = express.Router()
const User = require('../models/user')
const Product = require('../models/product')
const Order = require('../models/order')
const AuditLog = require('../models/auditLog')
const cloudinary = require('cloudinary').v2
const { protect, admin } = require('../middleware/auth')
const { aggregateOrderStatus, recordConfirmedRefund, releaseOrderInventory } = require('../services/orderService')
const { sendOrderStatusEmail } = require('../utils/email')
const { recordAudit } = require('../utils/audit')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})


// GET ALL USERS - GET /api/admin/users
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password -emailVerification -twoFactor -authSessions')
      .sort({ createdAt: -1 })
    res.json(users)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE USER - DELETE /api/admin/users/:id
router.delete('/users/:id', protect, admin, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own administrator account' })
    }
    const orderCount = await Order.countDocuments({ buyer: req.params.id })
    if (orderCount > 0) {
      return res.status(409).json({ message: 'This account has order records and must be handled through the privacy workflow' })
    }
    const user = await User.findByIdAndDelete(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    await recordAudit(req, {
      action: 'user_deleted', entityType: 'user', entityId: req.params.id,
      summary: `Deleted account ${user.email}`
    })
    res.json({ message: 'User deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// MAKE USER ADMIN - PUT /api/admin/users/:id/makeadmin
router.put('/users/:id/makeadmin', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    user.isAdmin = true
    await user.save()
    res.json({ message: 'User is now an admin' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// MAKE USER SELLER - PUT /api/admin/users/:id/makeseller
router.put('/users/:id/makeseller', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    user.isSeller = true
    await user.save()
    res.json({ message: 'User is now a seller' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET ALL ORDERS - GET /api/admin/orders
router.get('/orders', protect, admin, async (req, res) => {
  try {
    const orders = await Order.find({}).populate('buyer', 'name email').sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET DASHBOARD STATS - GET /api/admin/stats
router.get('/stats', protect, admin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments()
    const totalProducts = await Product.countDocuments()
    const pendingProducts = await Product.countDocuments({ approvalStatus: 'pending' })
    const approvedProducts = await Product.countDocuments({ approvalStatus: 'approved' })
    const rejectedProducts = await Product.countDocuments({ approvalStatus: 'rejected' })
    const pendingSellers = await User.countDocuments({
      isSeller: true,
      'sellerProfile.verificationStatus': 'pending'
    })
    const verifiedSellers = await User.countDocuments({
      isSeller: true,
      'sellerProfile.verificationStatus': 'verified'
    })
    const totalOrders = await Order.countDocuments()
    const cancellationRequests = await Order.countDocuments({ status: 'CancellationRequested' })
    const activeDisputes = await Order.countDocuments({ 'dispute.status': { $in: ['Open', 'UnderReview'] } })
    const lowStockProducts = await Product.countDocuments({
      approvalStatus: 'approved',
      $expr: { $lte: ['$countInStock', '$lowStockThreshold'] }
    })
    const privacyRequests = await User.countDocuments({ 'privacy.deletionStatus': 'pending' })
    const totalRevenue = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ])

    res.json({
      totalUsers,
      totalProducts,
      pendingProducts,
      approvedProducts,
      rejectedProducts,
      pendingSellers,
      verifiedSellers,
      totalOrders,
      cancellationRequests,
      activeDisputes,
      lowStockProducts,
      privacyRequests,
      totalRevenue: totalRevenue[0] ? totalRevenue[0].total : 0
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET ALL PRODUCTS - GET /api/admin/products
router.get('/products', protect, admin, async (req, res) => {
  try {
    const products = await Product.find({})
      .populate('seller', 'name email sellerProfile')
      .sort({ createdAt: -1 })
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// REVIEW PRODUCT - PUT /api/admin/products/:id/status
router.put('/products/:id/status', protect, admin, async (req, res) => {
  try {
    const { approvalStatus, rejectionReason = '' } = req.body
    const allowedStatuses = ['pending', 'approved', 'rejected']

    if (!allowedStatuses.includes(approvalStatus)) {
      return res.status(400).json({ message: 'Invalid product status' })
    }

    if (String(rejectionReason).length > 500) {
      return res.status(400).json({ message: 'Rejection note must be 500 characters or less' })
    }

    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    if (approvalStatus === 'approved') {
      const productSeller = await User.findById(product.seller).select(
        'isSeller isEmailVerified twoFactor.enabled sellerProfile.verificationStatus'
      )
      const sellerCanPublish = productSeller
        && productSeller.isSeller
        && productSeller.isEmailVerified !== false
        && productSeller.twoFactor?.enabled
        && productSeller.sellerProfile?.verificationStatus === 'verified'

      if (!sellerCanPublish) {
        return res.status(400).json({
          message: 'Verify the seller account, email and two-factor authentication before approving this product.'
        })
      }
    }

    product.approvalStatus = approvalStatus
    product.reviewedAt = new Date()
    product.rejectionReason = approvalStatus === 'rejected' ? rejectionReason : ''
    product.approvedAt = approvalStatus === 'approved' ? new Date() : undefined

    const updatedProduct = await product.save()
    await recordAudit(req, {
      action: `product_${approvalStatus}`,
      entityType: 'product',
      entityId: product._id.toString(),
      summary: `${product.name} marked ${approvalStatus}${rejectionReason ? `: ${rejectionReason}` : ''}`
    })
    const populatedProduct = await updatedProduct.populate('seller', 'name email sellerProfile')
    res.json(populatedProduct)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// REVIEW SELLER - PUT /api/admin/users/:id/seller-status
router.put('/users/:id/seller-status', protect, admin, async (req, res) => {
  try {
    const { verificationStatus, verificationNote = '' } = req.body
    const allowedStatuses = ['incomplete', 'pending', 'verified', 'rejected']

    if (!allowedStatuses.includes(verificationStatus)) {
      return res.status(400).json({ message: 'Invalid seller verification status' })
    }

    if (String(verificationNote).length > 500) {
      return res.status(400).json({ message: 'Verification note must be 500 characters or less' })
    }

    const user = await User.findById(req.params.id).select('-password -emailVerification -twoFactor')
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (verificationStatus === 'verified') {
      const requiredTypes = ['identity', 'business', 'address']
      const approvedTypes = new Set(
        (user.sellerProfile.documents || [])
          .filter(document => document.status === 'approved')
          .map(document => document.type)
      )
      const missing = requiredTypes.filter(type => !approvedTypes.has(type))
      if (missing.length) {
        return res.status(400).json({
          message: `Approve all required documents first: ${missing.join(', ')}`
        })
      }
    }

    user.isSeller = true
    user.sellerProfile.verificationStatus = verificationStatus
    user.sellerProfile.verificationNote = verificationStatus === 'rejected' ? verificationNote : ''
    user.sellerProfile.reviewedAt = new Date()
    user.sellerProfile.auditTrail.push({
      action: `seller_${verificationStatus}`,
      note: verificationNote,
      actor: req.user._id
    })

    if (verificationStatus === 'pending' && !user.sellerProfile.submittedAt) {
      user.sellerProfile.submittedAt = new Date()
    }

    const updatedUser = await user.save()
    await recordAudit(req, {
      action: `seller_${verificationStatus}`,
      entityType: 'seller',
      entityId: user._id.toString(),
      summary: `${user.email} marked ${verificationStatus}${verificationNote ? `: ${verificationNote}` : ''}`
    })
    res.json(updatedUser.toObject())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.get('/users/:id/documents/:documentId', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    const document = user?.sellerProfile?.documents?.id(req.params.documentId)
    if (!document) return res.status(404).json({ message: 'Verification document not found' })

    const url = cloudinary.utils.private_download_url(document.publicId, document.format || (document.mimeType === 'application/pdf' ? 'pdf' : 'jpg'), {
      type: 'authenticated',
      resource_type: document.resourceType,
      expires_at: Math.floor(Date.now() / 1000) + 300,
      attachment: false
    })
    res.json({ url, expiresIn: 300 })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.put('/users/:id/documents/:documentId', protect, admin, async (req, res) => {
  try {
    const status = String(req.body.status || '')
    const note = String(req.body.note || '').trim()
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Document status must be approved or rejected' })
    }
    if (note.length > 500) return res.status(400).json({ message: 'Review note is too long' })

    const user = await User.findById(req.params.id)
    const document = user?.sellerProfile?.documents?.id(req.params.documentId)
    if (!document) return res.status(404).json({ message: 'Verification document not found' })

    document.status = status
    document.note = note
    document.reviewedAt = new Date()
    document.reviewedBy = req.user._id
    user.sellerProfile.verificationStatus = status === 'rejected'
      ? 'rejected'
      : user.sellerProfile.submittedAt ? 'pending' : 'incomplete'
    user.sellerProfile.auditTrail.push({
      action: `document_${status}`,
      note: `${document.type}${note ? `: ${note}` : ''}`,
      actor: req.user._id
    })
    await user.save()
    await recordAudit(req, {
      action: `document_${status}`,
      entityType: 'document',
      entityId: document._id.toString(),
      summary: `${document.type} document for ${user.email} marked ${status}${note ? `: ${note}` : ''}`
    })
    res.json(user.toObject())
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.put('/orders/:id/cancellation', protect, admin, async (req, res) => {
  const session = await mongoose.startSession()
  try {
    const decision = String(req.body.decision || '')
    const note = String(req.body.note || '').trim().slice(0, 500)
    const providerReference = String(req.body.providerReference || '').trim().slice(0, 160)
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be approve or reject' })
    }
    if (decision === 'approve' && providerReference.length < 3) {
      return res.status(400).json({ message: 'Confirm the payment-provider refund reference before approving' })
    }

    let updatedOrder
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session)
      if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
      if (order.status !== 'CancellationRequested') {
        throw Object.assign(new Error('This order has no active cancellation request'), { statusCode: 409 })
      }

      if (decision === 'approve') {
        await releaseOrderInventory(order, session)
        const remaining = Math.max(0, Number(order.totalPrice) - Number(order.refundedAmount || 0))
        if (remaining > 0) {
          recordConfirmedRefund(order, {
            amount: remaining, providerReference,
            reason: note || order.cancellationReason, recordedBy: req.user._id
          })
        }
        order.status = 'Cancelled'
        order.cancelledAt = new Date()
        order.orderItems.forEach(item => { item.fulfillmentStatus = 'Cancelled' })
      } else {
        order.refundStatus = 'Rejected'
        aggregateOrderStatus(order)
        order.supportNotes.push({
          author: req.user._id,
          authorRole: 'admin',
          message: note || 'The cancellation request was reviewed and declined.',
          visibility: 'participants'
        })
      }
      updatedOrder = await order.save({ session })
    })

    await recordAudit(req, {
      action: decision === 'approve' ? 'cancellation_approved' : 'cancellation_rejected',
      entityType: 'order',
      entityId: req.params.id,
      summary: `Cancellation ${decision}d${note ? `: ${note}` : ''}`
    })
    const populated = await updatedOrder.populate('buyer', 'name email')
    await sendOrderStatusEmail({ order: populated, status: decision === 'approve' ? 'Cancellation and refund confirmed' : 'Cancellation request declined' })
    res.json(populated)
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Unable to resolve cancellation' })
  } finally {
    await session.endSession()
  }
})

router.put('/orders/:id/dispute', protect, admin, async (req, res) => {
  try {
    const status = String(req.body.status || '')
    const resolution = String(req.body.resolution || '').trim().slice(0, 1000)
    const refundAmount = Number(req.body.refundAmount || 0)
    const providerReference = String(req.body.providerReference || '').trim().slice(0, 160)
    if (!['UnderReview', 'Resolved', 'Closed'].includes(status)) {
      return res.status(400).json({ message: 'Choose a valid dispute status' })
    }
    if (['Resolved', 'Closed'].includes(status) && resolution.length < 5) {
      return res.status(400).json({ message: 'Add a clear resolution before closing the dispute' })
    }

    const order = await Order.findById(req.params.id).populate('buyer', 'name email')
    if (!order || !order.dispute?.openedAt) return res.status(404).json({ message: 'Dispute not found' })
    if (refundAmount > 0) {
      recordConfirmedRefund(order, {
        amount: refundAmount, providerReference,
        reason: resolution, recordedBy: req.user._id
      })
    }
    order.dispute.status = status
    order.dispute.resolution = resolution
    if (['Resolved', 'Closed'].includes(status)) {
      order.dispute.resolvedAt = new Date()
      order.dispute.resolvedBy = req.user._id
    }
    if (resolution) {
      order.supportNotes.push({
        author: req.user._id,
        authorRole: 'admin',
        message: resolution,
        visibility: 'participants'
      })
    }
    await order.save()
    await recordAudit(req, {
      action: `dispute_${status.toLowerCase()}`,
      entityType: 'order',
      entityId: order._id.toString(),
      summary: `${status}${refundAmount ? ` with ${refundAmount.toFixed(2)} refund` : ''}: ${resolution || 'No public resolution yet'}`
    })
    await sendOrderStatusEmail({ order, status: `Dispute ${status.toLowerCase()}` })
    res.json(order)
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Unable to update dispute' })
  }
})

router.post('/orders/:id/notes', protect, admin, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim()
    const visibility = req.body.visibility === 'participants' ? 'participants' : 'admin'
    if (message.length < 2 || message.length > 1000) {
      return res.status(400).json({ message: 'Note must be between 2 and 1000 characters' })
    }
    const order = await Order.findById(req.params.id).populate('buyer', 'name email')
    if (!order) return res.status(404).json({ message: 'Order not found' })
    order.supportNotes.push({ author: req.user._id, authorRole: 'admin', message, visibility })
    await order.save()
    await recordAudit(req, {
      action: 'order_note_added', entityType: 'order', entityId: order._id.toString(),
      summary: `${visibility === 'admin' ? 'Private' : 'Participant'} support note added`
    })
    res.status(201).json(order)
  } catch (error) {
    res.status(500).json({ message: 'Unable to add support note' })
  }
})

router.get('/audit', protect, admin, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit, 10) || 50))
    const query = req.query.action ? { action: String(req.query.action).slice(0, 100) } : {}
    const [items, total] = await Promise.all([
      AuditLog.find(query)
        .populate('actor', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      AuditLog.countDocuments(query)
    ])
    res.json({ items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } })
  } catch (error) {
    res.status(500).json({ message: 'Unable to load audit history' })
  }
})

// DELETE PRODUCT - DELETE /api/admin/products/:id
router.delete('/products/:id', protect, admin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json({ message: 'Product deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
