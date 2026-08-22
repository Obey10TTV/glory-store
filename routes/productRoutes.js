const express = require('express')
const router = express.Router()
const Product = require('../models/product')
const { protect, seller, verifiedSeller } = require('../middleware/auth')
const {
  validateProduct,
  handleValidationErrors
} = require('../middleware/security')
const { canonicalizeProductType } = require('../utils/catalogTaxonomy')
const {
  getEffectiveSellerPlan,
  getMarketplaceConfig,
  normalizeMarketCode,
  normalizePaymentMethods
} = require('../services/marketplaceService')
const { enforceSellerPlanVisibility } = require('../services/sellerPlanEnforcementService')
const { prepareProductImageProcessing } = require('../utils/productImageProcessing')
const cloudinary = require('cloudinary').v2

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const publicSellerFields = [
  'name',
  'sellerProfile.storeName',
  'sellerProfile.brandName',
  'sellerProfile.marketCode',
  'sellerProfile.verificationStatus',
  'sellerProfile.returnPolicy',
  'sellerProfile.returnPolicyDetail',
  'sellerProfile.responseTimeCommitment'
].join(' ')

const canManageProduct = (product, user) => {
  const sellerId = product.seller?._id || product.seller
  return user.isAdmin || sellerId?.toString() === user._id.toString()
}

const getSellerListingBrand = (user, requestedBrand = '') => {
  if (user.isAdmin) return String(requestedBrand || '').trim()
  return String(user.sellerProfile?.brandName || user.sellerProfile?.storeName || '').trim()
}

const prepareListingEvidence = (evidence = {}, { reviewed = false } = {}) => ({
  status: reviewed ? 'reviewed' : 'submitted',
  condition: evidence.condition,
  packagingPhotosConfirmed: evidence.packagingPhotosConfirmed === true || evidence.packagingPhotosConfirmed === 'true',
  batchCode: String(evidence.batchCode || '').trim(),
  expiryOrPao: String(evidence.expiryOrPao || '').trim(),
  supplierInvoiceAvailable: evidence.supplierInvoiceAvailable === true || evidence.supplierInvoiceAvailable === 'true',
  supplierInvoiceReference: String(evidence.supplierInvoiceReference || '').trim(),
  safetyDocumentationAvailable: evidence.safetyDocumentationAvailable === true || evidence.safetyDocumentationAvailable === 'true',
  responsiblePersonName: String(evidence.responsiblePersonName || '').trim(),
  declarationAccepted: evidence.declarationAccepted === true || evidence.declarationAccepted === 'true',
  submittedAt: new Date(),
  reviewedAt: reviewed ? new Date() : undefined
})

// GET ALL PRODUCTS - Public
router.get('/', async (req, res) => {
  try {
    const hasCatalogueQuery = Object.keys(req.query).length > 0
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 24))
    const query = { approvalStatus: 'approved', planVisibilityStatus: { $ne: 'paused' } }
    if (req.query.market) query.marketCode = normalizeMarketCode(req.query.market, 'NG')
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
    if (req.query.productType) {
      const productType = canonicalizeProductType(query.category, req.query.productType)
      if (!productType) {
        return res.status(400).json({ message: 'Choose a product type that belongs to the selected category' })
      }
      query.productType = productType
    }
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
      .populate('seller', publicSellerFields)
      .sort(sort)

    if (!hasCatalogueQuery) {
      // Preserve the legacy array response while preventing unbounded public
      // catalogue reads. Filtered catalogue requests retain pagination below.
      return res.json(await productQuery.limit(48))
    }

    const facetQuery = { ...query }
    delete facetQuery.brand
    delete facetQuery.productType
    const [products, total, categories, brands, productTypes] = await Promise.all([
      productQuery.skip((page - 1) * limit).limit(limit),
      Product.countDocuments(query),
      Product.distinct('category', {
        approvalStatus: 'approved',
        planVisibilityStatus: { $ne: 'paused' },
        ...(query.marketCode ? { marketCode: query.marketCode } : {})
      }),
      Product.distinct('brand', facetQuery),
      Product.distinct('productType', facetQuery)
    ])
    res.json({
      items: products,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      facets: {
        categories: categories.sort(),
        brands: brands.sort(),
        productTypes: productTypes.filter(Boolean).sort()
      }
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
      .lean()
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SINGLE PRODUCT - Public
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      approvalStatus: 'approved',
      planVisibilityStatus: { $ne: 'paused' }
    }).populate('seller', publicSellerFields)
    if (!product) {
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
      name, price, compareAtPrice, sku, size, productType, countryOfOrigin,
      barcode, description, ingredients, howToUse, keyBenefits, category,
      image, imageProcessing, images, variants, brand, countInStock, lowStockThreshold, listingEvidence,
      acceptedPaymentMethods
    } = req.body
    const listingBrand = getSellerListingBrand(req.user, brand)
    const canonicalProductType = canonicalizeProductType(category, productType)
    if (!listingBrand) {
      return res.status(400).json({ message: 'Add a brand name to your seller profile before submitting a listing.' })
    }
    if (!req.user.isAdmin) {
      const sellerPlan = getEffectiveSellerPlan(req.user.sellerProfile)
      const currentListingCount = await Product.countDocuments({
        seller: req.user._id,
        approvalStatus: { $ne: 'rejected' }
      })
      if (currentListingCount >= sellerPlan.activeListingLimit) {
        return res.status(403).json({
          message: `Your ${sellerPlan.label} plan supports up to ${sellerPlan.activeListingLimit} active or pending listings. Upgrade your seller plan or remove an existing listing first.`,
          code: 'SELLER_PLAN_LISTING_LIMIT',
          planCode: sellerPlan.code,
          activeListingLimit: sellerPlan.activeListingLimit
        })
      }
    }
    const marketCode = normalizeMarketCode(
      req.user.isAdmin ? req.body.marketCode : req.user.sellerProfile?.marketCode,
      'GB'
    )
    const marketplace = getMarketplaceConfig(marketCode)
    const listingPaymentMethods = normalizePaymentMethods(
      acceptedPaymentMethods,
      req.user.sellerProfile?.acceptedPaymentMethods || ['card'],
      marketCode
    )
    const product = await Product.create({
      name, price, compareAtPrice, sku, size, productType: canonicalProductType, countryOfOrigin,
      barcode, description, ingredients, howToUse, keyBenefits, category,
      image, images, variants, brand: listingBrand, countInStock, lowStockThreshold,
      imageProcessing: prepareProductImageProcessing(cloudinary, imageProcessing, {
        originalImageUrl: image,
        userId: req.user._id.toString(),
        isAdmin: req.user.isAdmin
      }),
      marketCode,
      currency: marketplace.currency,
      acceptedPaymentMethods: listingPaymentMethods,
      seller: req.user._id,
      approvalStatus: req.user.isAdmin ? 'approved' : 'pending',
      listingEvidence: prepareListingEvidence(listingEvidence, { reviewed: req.user.isAdmin }),
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
      'name', 'price', 'compareAtPrice', 'sku', 'size', 'productType',
      'countryOfOrigin', 'barcode', 'description', 'ingredients', 'howToUse',
      'keyBenefits', 'category', 'image', 'images', 'variants', 'brand',
      'countInStock', 'lowStockThreshold', 'listingEvidence', 'acceptedPaymentMethods'
    ]
    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        product[field] = req.body[field]
      }
    })
    if (Object.prototype.hasOwnProperty.call(req.body, 'imageProcessing') || Object.prototype.hasOwnProperty.call(req.body, 'image')) {
      product.imageProcessing = prepareProductImageProcessing(cloudinary, req.body.imageProcessing, {
        originalImageUrl: product.image,
        userId: req.user._id.toString(),
        isAdmin: req.user.isAdmin
      })
    }
    product.productType = canonicalizeProductType(product.category, product.productType)
    if (!product.productType) {
      return res.status(400).json({ message: 'Choose a product type that belongs to the selected category.' })
    }
    if (!req.user.isAdmin) {
      const listingBrand = getSellerListingBrand(req.user)
      if (!listingBrand) {
        return res.status(400).json({ message: 'Add a brand name to your seller profile before updating a listing.' })
      }
      product.brand = listingBrand
    }
    product.acceptedPaymentMethods = normalizePaymentMethods(
      product.acceptedPaymentMethods,
      req.user.sellerProfile?.acceptedPaymentMethods || ['card'],
      product.marketCode
    )

    if (!req.user.isAdmin) {
      product.approvalStatus = 'pending'
      product.rejectionReason = ''
      product.submittedAt = new Date()
      product.approvedAt = undefined
      product.reviewedAt = undefined
      product.listingEvidence = prepareListingEvidence(req.body.listingEvidence)
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'listingEvidence')) {
      product.listingEvidence = prepareListingEvidence(req.body.listingEvidence, { reviewed: true })
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
    if (!req.user.isAdmin) await enforceSellerPlanVisibility(req.user._id)
    res.json({ message: 'Product deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
