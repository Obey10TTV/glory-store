const express = require('express')
const router = express.Router()
const Product = require('../models/product')
const { protect, seller, verifiedSeller } = require('../middleware/auth')
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
    const hasCatalogueQuery = Object.keys(req.query).length > 0
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 24))
    const query = { approvalStatus: 'approved' }
    const q = String(req.query.q || '').trim().slice(0, 100)
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query.$or = [
        { name: new RegExp(escaped, 'i') },
        { brand: new RegExp(escaped, 'i') },
        { description: new RegExp(escaped, 'i') }
      ]
    }
    if (req.query.category) query.category = String(req.query.category).slice(0, 80)
    if (req.query.brand) query.brand = String(req.query.brand).slice(0, 80)
    if (req.query.minPrice || req.query.maxPrice) {
      query.price = {}
      if (req.query.minPrice) query.price.$gte = Math.max(0, Number(req.query.minPrice) || 0)
      if (req.query.maxPrice) query.price.$lte = Math.max(0, Number(req.query.maxPrice) || 0)
    }
    const sortOptions = {
      newest: { createdAt: -1 },
      price_asc: { price: 1, createdAt: -1 },
      price_desc: { price: -1, createdAt: -1 },
      rating: { rating: -1, numReviews: -1 }
    }
    const sort = sortOptions[req.query.sort] || sortOptions.newest

    const productQuery = Product.find(query)
      .populate('seller', 'name sellerProfile.storeName sellerProfile.verificationStatus')
      .sort(sort)

    if (!hasCatalogueQuery) {
      return res.json(await productQuery)
    }

    const [products, total, categories, brands] = await Promise.all([
      productQuery.skip((page - 1) * limit).limit(limit),
      Product.countDocuments(query),
      Product.distinct('category', { approvalStatus: 'approved' }),
      Product.distinct('brand', { approvalStatus: 'approved' })
    ])
    res.json({
      items: products,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      facets: { categories: categories.sort(), brands: brands.sort() }
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SELLER PRODUCTS - Seller/Admin only
router.get('/mine', protect, seller, async (req, res) => {
  try {
    const query = req.user.isAdmin ? {} : { seller: req.user._id }
    const products = await Product.find(query)
      .populate('seller', 'name email sellerProfile')
      .sort({ createdAt: -1 })
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SINGLE PRODUCT - Public
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('seller', 'name sellerProfile.storeName sellerProfile.verificationStatus')
    if (!product || product.approvalStatus !== 'approved') {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// CREATE PRODUCT - Seller only
router.post('/', protect, verifiedSeller, validateProduct, handleValidationErrors, async (req, res) => {
  try {
    const {
      name, price, compareAtPrice, sku, size, description, ingredients,
      howToUse, category, image, images, variants, brand, countInStock
    } = req.body
    const product = await Product.create({
      name, price, compareAtPrice, sku, size, description, ingredients,
      howToUse, category,
      image, images, variants, brand, countInStock,
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
router.put('/:id', protect, verifiedSeller, validateProduct, handleValidationErrors, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    if (!canManageProduct(product, req.user)) {
      return res.status(403).json({ message: 'Not authorized to update this product' })
    }

    const allowedFields = [
      'name', 'price', 'compareAtPrice', 'sku', 'size', 'description',
      'ingredients', 'howToUse', 'category', 'image', 'images', 'variants', 'brand', 'countInStock'
    ]
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
