const mongoose = require('mongoose')

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  rating: { type: Number, required: true },
  comment: { type: String, required: true }
}, { timestamps: true })

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 64, default: '' },
  price: { type: Number, min: 0.01 },
  countInStock: { type: Number, min: 0, default: 0 },
  image: { type: String, trim: true, default: '' }
})

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  compareAtPrice: { type: Number, min: 0 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 64, default: '' },
  size: { type: String, trim: true, maxlength: 80, default: '' },
  productType: { type: String, trim: true, maxlength: 100, default: '' },
  countryOfOrigin: { type: String, trim: true, maxlength: 100, default: '' },
  barcode: { type: String, trim: true, maxlength: 64, default: '' },
  description: { type: String, required: true },
  ingredients: { type: String, trim: true, maxlength: 2000, default: '' },
  howToUse: { type: String, trim: true, maxlength: 1200, default: '' },
  keyBenefits: { type: [String], default: [] },
  category: {
    type: String,
    required: true,
    enum: [
      'Skincare', 'Haircare', 'Makeup', 'Nails', 'Lashes',
      'Body Care', 'Body Liquid', 'Fragrance', 'Scented Candles',
      'Tools & Accessories'
    ]
  },
  image: { type: String, required: true },
  images: { type: [String], default: [] },
  variants: { type: [variantSchema], default: [] },
  brand: { type: String, required: true },
  countInStock: { type: Number, required: true, default: 0 },
  lowStockThreshold: { type: Number, min: 0, max: 1000, default: 5 },
  rating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 },
  reviews: [reviewSchema],
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  rejectionReason: { type: String, default: '' },
  submittedAt: Date,
  approvedAt: Date,
  reviewedAt: Date
}, { timestamps: true })

productSchema.index({ name: 'text', brand: 'text', description: 'text', category: 'text' })
productSchema.index({ approvalStatus: 1, category: 1, brand: 1, price: 1, createdAt: -1 })
productSchema.index({ seller: 1, countInStock: 1 })

productSchema.pre('validate', function(next) {
  if (this.variants?.length) {
    this.countInStock = this.variants.reduce((sum, variant) => sum + Number(variant.countInStock || 0), 0)
  }
  next()
})

module.exports = mongoose.model('Product', productSchema)
