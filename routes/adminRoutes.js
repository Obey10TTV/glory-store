const express = require('express')
const router = express.Router()
const User = require('../models/user')
const Product = require('../models/product')
const Order = require('../models/order')
const cloudinary = require('cloudinary').v2
const { protect, admin } = require('../middleware/auth')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})


// GET ALL USERS - GET /api/admin/users
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password -emailVerification -twoFactor -authSessions')
    res.json(users)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE USER - DELETE /api/admin/users/:id
router.delete('/users/:id', protect, admin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
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
    const orders = await Order.find({}).populate('buyer', 'name email')
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
    res.json(user.toObject())
  } catch (error) {
    res.status(500).json({ message: error.message })
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
