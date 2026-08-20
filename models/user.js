const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const BCRYPT_ROUNDS = Math.max(12, Number(process.env.BCRYPT_ROUNDS || 12))

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
  lastAuthenticatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, { _id: false })

const sellerDocumentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['identity', 'business', 'tax', 'address', 'insurance'],
    required: true
  },
  kind: { type: String, trim: true, maxlength: 64, default: '' },
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
    required: function() {
      return !this.googleSubject
    }
  },
  googleSubject: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true,
    select: false
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
  isSuperAdmin: {
    type: Boolean,
    default: false,
    select: false
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
  privacy: {
    exportRequestedAt: Date,
    deletionRequestedAt: Date,
    deletionStatus: {
      type: String,
      enum: ['none', 'pending', 'cancelled', 'completed'],
      default: 'none'
    }
  },
  sellerProfile: {
    brandName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
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
      default: 'United Kingdom'
    },
    marketCode: {
      type: String,
      enum: ['NG', 'GB', 'US', 'CA'],
      default: 'GB',
      index: true
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
    businessType: {
      type: String,
      enum: ['registered_business', 'sole_trader', 'independent_seller'],
      default: 'independent_seller'
    },
    taxStatus: {
      type: String,
      enum: ['not_registered', 'registered', 'not_applicable'],
      default: 'not_registered'
    },
    returnPolicy: {
      type: String,
      enum: ['not_specified', 'returns_accepted', 'final_sale', 'contact_seller'],
      default: 'not_specified'
    },
    returnPolicyDetail: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    responseTimeCommitment: {
      type: String,
      enum: ['not_specified', 'within_24_hours', 'within_48_hours', 'within_3_days'],
      default: 'not_specified'
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
    identityVerification: {
      provider: {
        type: String,
        enum: ['none', 'stripe_identity', 'manual_alternative'],
        default: 'none'
      },
      status: {
        type: String,
        enum: ['not_started', 'requires_input', 'processing', 'verified', 'cancelled', 'redaction_pending', 'redacted'],
        default: 'not_started',
        index: true
      },
      sessionId: {
        type: String,
        trim: true,
        default: '',
        select: false
      },
      disclosureAcceptedAt: Date,
      verifiedAt: Date,
      lastCheckedAt: Date,
      lastErrorCode: { type: String, trim: true, maxlength: 80, default: '' },
      lastErrorReason: { type: String, trim: true, maxlength: 300, default: '' },
      redactionRequestedAt: Date,
      redactedAt: Date
    },
    documents: {
      type: [sellerDocumentSchema],
      default: []
    },
    auditTrail: {
      type: [sellerAuditSchema],
      default: []
    },
    acceptedPaymentMethods: {
      type: [{
        type: String,
        enum: ['card', 'bank_transfer', 'ussd', 'crypto', 'cash_on_delivery']
      }],
      default: ['card']
    },
    activationStatus: {
      type: String,
      enum: ['unpaid', 'pending', 'paid', 'waived'],
      default: 'unpaid'
    },
    activationAmountPence: {
      type: Number,
      min: 0,
      default: 0
    },
    activationCurrency: {
      type: String,
      enum: ['NGN', 'GBP', 'USD', 'CAD'],
      default: 'GBP'
    },
    activationPaymentReference: {
      type: String,
      trim: true,
      default: ''
    },
    activationPaidAt: Date,
    membershipPlanCode: {
      type: String,
      enum: ['starter', 'studio', 'scale', 'partner'],
      default: 'starter'
    },
    membershipStatus: {
      type: String,
      enum: ['active', 'pending', 'past_due', 'cancelled'],
      default: 'active',
      index: true
    },
    membershipCurrentPeriodEnd: Date,
    membershipCancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    membershipProvider: {
      type: String,
      enum: ['none', 'stripe', 'paystack'],
      default: 'none'
    },
    membershipCurrency: {
      type: String,
      enum: ['NGN', 'GBP', 'USD', 'CAD'],
      default: 'GBP'
    },
    membershipPaymentReference: {
      type: String,
      trim: true,
      default: '',
      select: false
    },
    billingCustomerId: {
      type: String,
      trim: true,
      default: '',
      select: false
    },
    billingSubscriptionId: {
      type: String,
      trim: true,
      default: '',
      select: false
    },
    stripeAccountId: {
      type: String,
      trim: true,
      default: ''
    },
    payoutStatus: {
      type: String,
      enum: ['not_started', 'pending', 'active', 'restricted'],
      default: 'not_started'
    },
    stripeDetailsSubmitted: {
      type: Boolean,
      default: false
    },
    stripeChargesEnabled: {
      type: Boolean,
      default: false
    },
    stripePayoutsEnabled: {
      type: Boolean,
      default: false
    },
    payoutStatusUpdatedAt: Date,
    submittedAt: Date,
    reviewedAt: Date
  }
}, {
  timestamps: true
})

const removeSensitiveFields = (ret) => {
  delete ret.password
  delete ret.googleSubject
  delete ret.isSuperAdmin
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
  if (ret.sellerProfile) {
    delete ret.sellerProfile.stripeAccountId
    delete ret.sellerProfile.activationPaymentReference
    delete ret.sellerProfile.billingCustomerId
    delete ret.sellerProfile.billingSubscriptionId
    delete ret.sellerProfile.membershipPaymentReference
    if (ret.sellerProfile.identityVerification) {
      delete ret.sellerProfile.identityVerification.sessionId
      delete ret.sellerProfile.identityVerification.lastErrorCode
    }
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
  if (!this.isModified('password') || !this.password) {
    return
  }
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS)
  this.password = await bcrypt.hash(this.password, salt)
})

userSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password) {
    return false
  }

  return await bcrypt.compare(enteredPassword, this.password)
}

module.exports = mongoose.model('User', userSchema)
