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
    }
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
    submittedAt: Date,
    reviewedAt: Date
  }
}, {
  timestamps: true
})

const removeSensitiveFields = (ret) => {
  delete ret.password
  delete ret.emailVerification
  ret.twoFactorEnabled = Boolean(ret.twoFactor?.enabled)
  delete ret.twoFactor
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
