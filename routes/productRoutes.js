const express = require('express')
const router = express.Router()
const Product = require('../models/product')
const { protect, seller } = require('../middleware/auth')
const {
  validateProduct,
  handleValidationErrors
} = require('../middleware/security')

const canManageProduct = (product, user) => {
  const sellerId = product.seller?._id || product.seller
  return user.isAdmin || sellerId?.toString() === user._id.toString()
}

// GET ALL PRODUCTS - Public
router.get('/', async (req, res) => {
  try {
    const products = await Product.find({ approvalStatus: 'approved' })
      .populate('seller', 'name email')
      .sort({ createdAt: -1 })
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SELLER PRODUCTS - Seller/Admin only
router.get('/mine', protect, seller, async (req, res) => {
  try {
    const query = req.user.isAdmin ? {} : { seller: req.user._id }
    const products = await Product.find(query)
      .populate('seller', 'name email')
      .sort({ createdAt: -1 })
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SINGLE PRODUCT - Public
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('seller', 'name email')
    if (!product || product.approvalStatus !== 'approved') {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// CREATE PRODUCT - Seller only
router.post('/', protect, seller, validateProduct, handleValidationErrors, async (req, res) => {
  try {
    const { name, price, description, category, image, brand, countInStock } = req.body
    const product = await Product.create({
      name, price, description, category,
      image, brand, countInStock,
      seller: req.user._id,
      approvalStatus: req.user.isAdmin ? 'approved' : 'pending',
      submittedAt: new Date(),
      approvedAt: req.user.isAdmin ? new Date() : undefined,
      reviewedAt: req.user.isAdmin ? new Date() : undefined,
      rejectionReason: ''
    })
    res.status(201).json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// UPDATE PRODUCT - Seller only
router.put('/:id', protect, seller, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    if (!canManageProduct(product, req.user)) {
      return res.status(403).json({ message: 'Not authorized to update this product' })
    }

    const allowedFields = ['name', 'price', 'description', 'category', 'image', 'brand', 'countInStock']
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        product[field] = req.body[field]
      }
    })

    if (!req.user.isAdmin) {
      product.approvalStatus = 'pending'
      product.rejectionReason = ''
      product.submittedAt = new Date()
      product.approvedAt = undefined
      product.reviewedAt = undefined
    }

    const updatedProduct = await product.save()
    res.json(updatedProduct)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE PRODUCT - Seller only
router.delete('/:id', protect, seller, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    if (!canManageProduct(product, req.user)) {
      return res.status(403).json({ message: 'Not authorized to delete this product' })
    }
    await Product.findByIdAndDelete(req.params.id)
    res.json({ message: 'Product deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
