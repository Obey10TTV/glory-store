const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const otpChallengeSchema = new mongoose.Schema({
  codeHash: {
    type: String,
    default: ''
  },
  expiresAt: Date,
  lastSentAt: Date,
  attempts: {
    type: Number,
    default: 0
  }
}, {
  _id: false
})

const authSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  tokenHash: { type: String, required: true },
  deviceLabel: { type: String, maxlength: 120, default: 'Browser session' },
  userAgent: { type: String, maxlength: 240, default: '' },
  ipHash: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, { _id: false })

const sellerDocumentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['identity', 'business', 'address'],
    required: true
  },
  publicId: { type: String, required: true },
  resourceType: { type: String, enum: ['image', 'raw'], default: 'image' },
  format: { type: String, maxlength: 20, default: '' },
  originalName: { type: String, maxlength: 180, default: '' },
  mimeType: { type: String, maxlength: 100, default: '' },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  note: { type: String, maxlength: 500, default: '' },
  uploadedAt: { type: Date, default: Date.now },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
})

const sellerAuditSchema = new mongoose.Schema({
  action: { type: String, required: true, maxlength: 80 },
  note: { type: String, maxlength: 500, default: '' },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false })

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  isEmailVerified: {
    type: Boolean,
    default: true
  },
  emailVerification: {
    type: otpChallengeSchema,
    default: () => ({})
  },
  twoFactor: {
    enabled: {
      type: Boolean,
      default: false
    },
    pending: {
      type: otpChallengeSchema,
      default: () => ({})
    },
    login: {
      type: otpChallengeSchema,
      default: () => ({})
    },
    disable: {
      type: otpChallengeSchema,
      default: () => ({})
    },
    recoveryCodeHashes: {
      type: [String],
      default: []
    }
  },
  authSessions: {
    type: [authSessionSchema],
    default: []
  },
  isSeller: {
    type: Boolean,
    default: false
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  avatar: {
    type: String,
    default: ''
  },
  address: {
    street: String,
    city: String,
    state: String,
    phone: String
  },
  sellerProfile: {
    storeName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 600,
      default: ''
    },
    businessEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    city: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    province: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    country: {
      type: String,
      trim: true,
      default: 'Canada'
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    instagram: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    verificationStatus: {
      type: String,
      enum: ['incomplete', 'pending', 'verified', 'rejected'],
      default: 'incomplete',
      index: true
    },
    verificationNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    documents: {
      type: [sellerDocumentSchema],
      default: []
    },
    auditTrail: {
      type: [sellerAuditSchema],
      default: []
    },
    submittedAt: Date,
    reviewedAt: Date
  }
}, {
  timestamps: true
})

const removeSensitiveFields = (ret) => {
  delete ret.password
  delete ret.emailVerification
  delete ret.authSessions
  ret.twoFactorEnabled = Boolean(ret.twoFactor?.enabled)
  delete ret.twoFactor
  if (ret.sellerProfile?.documents) {
    ret.sellerProfile.documents = ret.sellerProfile.documents.map((document) => {
      const safeDocument = { ...document }
      delete safeDocument.publicId
      delete safeDocument.resourceType
      delete safeDocument.format
      delete safeDocument.reviewedBy
      return safeDocument
    })
  }
  return ret
}

userSchema.set('toJSON', {
  transform: (doc, ret) => removeSensitiveFields(ret)
})

userSchema.set('toObject', {
  transform: (doc, ret) => removeSensitiveFields(ret)
})

userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return
  }
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

module.exports = mongoose.model('User', userSchema)
