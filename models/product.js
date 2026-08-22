const mongoose = require('mongoose')

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 64, default: '' },
  price: { type: Number, min: 0.01 },
  countInStock: { type: Number, min: 0, default: 0 },
  image: { type: String, trim: true, default: '' }
})

const listingEvidenceSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['not_submitted', 'submitted', 'reviewed', 'needs_more_information', 'rejected'],
    default: 'not_submitted',
    index: true
  },
  condition: {
    type: String,
    enum: ['new_sealed', 'new_unsealed', 'sample'],
    default: 'new_sealed'
  },
  packagingPhotosConfirmed: { type: Boolean, default: false },
  batchCode: { type: String, trim: true, maxlength: 80, default: '' },
  expiryOrPao: { type: String, trim: true, maxlength: 80, default: '' },
  supplierInvoiceAvailable: { type: Boolean, default: false },
  supplierInvoiceReference: { type: String, trim: true, maxlength: 160, default: '' },
  safetyDocumentationAvailable: { type: Boolean, default: false },
  responsiblePersonName: { type: String, trim: true, maxlength: 160, default: '' },
  declarationAccepted: { type: Boolean, default: false },
  brandAuthorisationStatus: {
    type: String,
    enum: ['not_reviewed', 'authorised', 'not_applicable'],
    default: 'not_reviewed'
  },
  submittedAt: Date,
  reviewedAt: Date
}, { _id: false })

// This is deliberately a proof reference only. Product documents, supplier
// records and identity information remain in Glory's private systems.
const suiVerificationSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['not_requested', 'pending', 'verified', 'revoked'],
    default: 'not_requested',
    index: true
  },
  network: { type: String, enum: ['testnet'], default: 'testnet' },
  attestationHash: { type: String, trim: true, lowercase: true, maxlength: 128, default: '' },
  packageId: { type: String, trim: true, maxlength: 100, default: '' },
  registryObjectId: { type: String, trim: true, maxlength: 100, default: '' },
  objectId: { type: String, trim: true, maxlength: 100, default: '' },
  transactionDigest: { type: String, trim: true, maxlength: 128, default: '' },
  verifiedAt: Date,
  revokedAt: Date
}, { _id: false })

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  marketCode: {
    type: String,
    enum: ['NG', 'GB', 'US', 'CA'],
    default: 'GB',
    required: true,
    index: true
  },
  currency: {
    type: String,
    enum: ['NGN', 'GBP', 'USD', 'CAD'],
    default: 'GBP',
    required: true
  },
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
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  planVisibilityStatus: {
    type: String,
    enum: ['visible', 'paused'],
    default: 'visible',
    index: true
  },
  acceptedPaymentMethods: {
    type: [{
      type: String,
      enum: ['card', 'bank_transfer', 'ussd', 'crypto', 'cash_on_delivery']
    }],
    default: []
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
  reviewedAt: Date,
  listingEvidence: { type: listingEvidenceSchema, default: () => ({}) },
  suiVerification: { type: suiVerificationSchema, default: () => ({}) }
}, { timestamps: true })

productSchema.index({ name: 'text', brand: 'text', description: 'text', category: 'text' })
productSchema.index({ marketCode: 1, approvalStatus: 1, category: 1, productType: 1, brand: 1, price: 1, createdAt: -1 })
productSchema.index({ seller: 1, countInStock: 1 })
productSchema.index({ seller: 1, planVisibilityStatus: 1, createdAt: 1 })
productSchema.index({ 'suiVerification.attestationHash': 1 }, { sparse: true })

productSchema.set('toJSON', {
  transform: (doc, ret) => {
    if (ret.listingEvidence) {
      delete ret.listingEvidence.batchCode
      delete ret.listingEvidence.expiryOrPao
      delete ret.listingEvidence.supplierInvoiceAvailable
      delete ret.listingEvidence.supplierInvoiceReference
      delete ret.listingEvidence.safetyDocumentationAvailable
      delete ret.listingEvidence.responsiblePersonName
      delete ret.listingEvidence.packagingPhotosConfirmed
      delete ret.listingEvidence.declarationAccepted
    }
    return ret
  }
})

productSchema.pre('validate', function(next) {
  if (this.variants?.length) {
    this.countInStock = this.variants.reduce((sum, variant) => sum + Number(variant.countInStock || 0), 0)
  }
  next()
})

module.exports = mongoose.model('Product', productSchema)
