const mongoose = require('mongoose')

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: { type: String, required: true },
  rating: { type: Number, required: true },
  comment: { type: String, required: true }
}, { timestamps: true })

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  compareAtPrice: { type: Number, min: 0 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 64, default: '' },
  size: { type: String, trim: true, maxlength: 80, default: '' },
  description: { type: String, required: true },
  ingredients: { type: String, trim: true, maxlength: 2000, default: '' },
  howToUse: { type: String, trim: true, maxlength: 1200, default: '' },
  category: {
    type: String,
    required: true,
    enum: [
      'Skincare',
      'Haircare',
      'Makeup',
      'Nails',
      'Lashes',
      'Body Care',
      'Body Liquid',
      'Fragrance',
      'Scented Candles',
      'Tools & Accessories'
    ]
  },
  image: { type: String, required: true },
  brand: { type: String, required: true },
  countInStock: { type: Number, required: true, default: 0 },
  rating: { type: Number, default: 0 },
  numReviews: { type: Number, default: 0 },
  reviews: [reviewSchema],
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
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

module.exports = mongoose.model('Product', productSchema)
