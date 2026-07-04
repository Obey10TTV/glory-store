const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/user')
const { protect } = require('../middleware/auth')
const {
  validateRegister,
  validateLogin,
  validateEmailOtp,
  validateEmailOnly,
  validateOtpOnly,
  validateSellerProfile,
  handleValidationErrors
} = require('../middleware/security')
const {
  generateOtp,
  createOtpChallenge,
  isInCooldown,
  verifyOtpChallenge
} = require('../utils/otp')
const { sendOtpEmail } = require('../utils/email')

// Admin-only middleware for this file
const adminOnly = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    return next()
  }

  return res.status(403).json({ message: 'Not authorized as admin' })
}

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' })
}

const getAuthPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  isSeller: user.isSeller,
  isAdmin: user.isAdmin,
  isEmailVerified: user.isEmailVerified !== false,
  twoFactorEnabled: Boolean(user.twoFactor?.enabled),
  sellerProfile: user.sellerProfile,
  token: generateToken(user._id)
})

const waitError = () => {
  const error = new Error('Please wait 60 seconds before requesting another code.')
  error.statusCode = 429
  return error
}

const sendChallenge = async (user, challenge, assignChallenge, purpose) => {
  if (isInCooldown(challenge)) {
    throw waitError()
  }

  const otp = generateOtp()
  assignChallenge(createOtpChallenge(otp))
  await user.save()
  await sendOtpEmail({ to: user.email, code: otp, purpose })
}

const sendEmailVerification = (user) => (
  sendChallenge(
    user,
    user.emailVerification,
    (challenge) => {
      user.emailVerification = challenge
    },
    'verify-email'
  )
)

const ensureTwoFactor = (user) => {
  if (!user.twoFactor) {
    user.twoFactor = {}
  }

  user.twoFactor.enabled = Boolean(user.twoFactor.enabled)
  user.twoFactor.pending = user.twoFactor.pending || {}
  user.twoFactor.login = user.twoFactor.login || {}
  user.twoFactor.disable = user.twoFactor.disable || {}
}

const sendTwoFactorLoginCode = (user) => (
  ensureTwoFactor(user),
  sendChallenge(
    user,
    user.twoFactor?.login,
    (challenge) => {
      user.twoFactor.login = challenge
    },
    'login-2fa'
  )
)

const sendTwoFactorSetupCode = (user) => (
  ensureTwoFactor(user),
  sendChallenge(
    user,
    user.twoFactor?.pending,
    (challenge) => {
      user.twoFactor.pending = challenge
    },
    'enable-2fa'
  )
)

const sendTwoFactorDisableCode = (user) => (
  ensureTwoFactor(user),
  sendChallenge(
    user,
    user.twoFactor?.disable,
    (challenge) => {
      user.twoFactor.disable = challenge
    },
    'disable-2fa'
  )
)

const handleRouteError = (res, error) => {
  const status = error.statusCode || 500
  res.status(status).json({
    message: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Something went wrong on our end'
      : error.message
  })
}

const requiredSellerProfileFields = ['storeName', 'businessEmail', 'phone', 'city', 'province']

const isSellerProfileComplete = (sellerProfile = {}) => (
  requiredSellerProfileFields.every((field) => String(sellerProfile[field] || '').trim().length > 0)
)

// REGISTER
router.post('/register', validateRegister, handleValidationErrors, async (req, res) => {
  try {
    const { name, email, password, isSeller } = req.body

    const userExists = await User.findOne({ email })

    if (userExists) {
      if (userExists.isEmailVerified === false) {
        await sendEmailVerification(userExists)
        return res.status(202).json({
          requiresEmailVerification: true,
          email: userExists.email,
          message: 'We sent a new verification code to your email.'
        })
      }

      return res.status(400).json({ message: 'User already exists' })
    }

    const user = await User.create({
      name,
      email,
      password,
      isSeller: isSeller || false,
      isEmailVerified: false
    })

    await sendEmailVerification(user)

    res.status(201).json({
      requiresEmailVerification: true,
      email: user.email,
      isSeller: user.isSeller,
      message: 'We sent a verification code to your email.'
    })
  } catch (error) {
    handleRouteError(res, error)
  }
})

// LOGIN
router.post('/login', validateLogin, handleValidationErrors, async (req, res) => {
  try {
    const { email, password } = req.body

    const user = await User.findOne({ email })

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    const isMatch = await bcrypt.compare(password, user.password)

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (user.isEmailVerified === false) {
      await sendEmailVerification(user)
      return res.status(403).json({
        requiresEmailVerification: true,
        email: user.email,
        message: 'Please verify your email before signing in. We sent you a new code.'
      })
    }

    if (user.twoFactor?.enabled) {
      await sendTwoFactorLoginCode(user)
      return res.json({
        requiresTwoFactor: true,
        email: user.email,
        message: 'Enter the verification code sent to your email.'
      })
    }

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

// VERIFY EMAIL OTP
router.post('/verify-email', validateEmailOtp, handleValidationErrors, async (req, res) => {
  try {
    const { email, otp } = req.body
    const user = await User.findOne({ email })

    if (!user) {
      return res.status(400).json({ message: 'Verification code is invalid.' })
    }

    if (user.isEmailVerified !== false) {
      return res.status(400).json({ message: 'This email is already verified. Please sign in.' })
    }

    const result = verifyOtpChallenge(user.emailVerification, otp)
    if (!result.valid) {
      await user.save()
      return res.status(400).json({ message: result.message })
    }

    user.isEmailVerified = true
    user.emailVerification = {}
    await user.save()

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

// RESEND EMAIL OTP
router.post('/resend-verification', validateEmailOnly, handleValidationErrors, async (req, res) => {
  try {
    const { email } = req.body
    const user = await User.findOne({ email })

    if (user && user.isEmailVerified === false) {
      await sendEmailVerification(user)
    }

    res.json({
      requiresEmailVerification: true,
      email,
      message: 'If that email needs verification, a new code has been sent.'
    })
  } catch (error) {
    handleRouteError(res, error)
  }
})

// VERIFY LOGIN 2FA OTP
router.post('/2fa/verify-login', validateEmailOtp, handleValidationErrors, async (req, res) => {
  try {
    const { email, otp } = req.body
    const user = await User.findOne({ email })

    if (!user || !user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Verification code is invalid.' })
    }

    const result = verifyOtpChallenge(user.twoFactor.login, otp)
    if (!result.valid) {
      await user.save()
      return res.status(400).json({ message: result.message })
    }

    user.twoFactor.login = {}
    await user.save()

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

// START 2FA SETUP
router.post('/2fa/enable/start', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is already enabled.' })
    }

    await sendTwoFactorSetupCode(user)

    res.json({ message: 'We sent a two-factor setup code to your email.' })
  } catch (error) {
    handleRouteError(res, error)
  }
})

// CONFIRM 2FA SETUP
router.post('/2fa/enable/confirm', protect, validateOtpOnly, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    ensureTwoFactor(user)
    const result = verifyOtpChallenge(user.twoFactor?.pending, req.body.otp)
    if (!result.valid) {
      await user.save()
      return res.status(400).json({ message: result.message })
    }

    user.twoFactor.enabled = true
    user.twoFactor.pending = {}
    user.twoFactor.login = {}
    await user.save()

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

// START 2FA DISABLE
router.post('/2fa/disable/start', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Two-factor authentication is not enabled.' })
    }

    await sendTwoFactorDisableCode(user)

    res.json({ message: 'We sent a two-factor disable code to your email.' })
  } catch (error) {
    handleRouteError(res, error)
  }
})

// CONFIRM 2FA DISABLE
router.post('/2fa/disable/confirm', protect, validateOtpOnly, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    ensureTwoFactor(user)
    const result = verifyOtpChallenge(user.twoFactor?.disable, req.body.otp)
    if (!result.valid) {
      await user.save()
      return res.status(400).json({ message: result.message })
    }

    user.twoFactor.enabled = false
    user.twoFactor.disable = {}
    user.twoFactor.login = {}
    await user.save()

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

// MAKE USER ADMIN
// Protected: only existing admins can make another user admin/seller
router.put('/makeadmin', protect, adminOnly, async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ message: 'Email is required' })
    }

    const user = await User.findOne({ email })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    user.isAdmin = true
    user.isSeller = true

    await user.save()

    res.json({
      message: 'User is now admin and seller',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isSeller: user.isSeller,
        isAdmin: user.isAdmin
      }
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET PROFILE
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password')

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    res.json(user)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// UPDATE SELLER PROFILE
router.put('/seller-profile', protect, validateSellerProfile, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!user.isSeller) {
      return res.status(403).json({ message: 'Only sellers can update seller profiles' })
    }

    const allowedFields = [
      'storeName',
      'bio',
      'businessEmail',
      'phone',
      'city',
      'province',
      'country',
      'website',
      'instagram'
    ]

    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        user.sellerProfile[field] = req.body[field]
      }
    })

    if (req.body.submitForReview) {
      if (!isSellerProfileComplete(user.sellerProfile)) {
        return res.status(400).json({
          message: 'Please complete store name, business email, phone, city and province before submitting for verification.'
        })
      }

      if (user.sellerProfile.verificationStatus !== 'verified') {
        user.sellerProfile.verificationStatus = 'pending'
        user.sellerProfile.submittedAt = new Date()
        user.sellerProfile.reviewedAt = undefined
        user.sellerProfile.verificationNote = ''
      }
    }

    const updatedUser = await user.save()
    res.json(getAuthPayload(updatedUser))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// UPDATE PROFILE
router.put('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    user.name = req.body.name || user.name
    if (req.body.password) {
      user.password = req.body.password
    }

    const updatedUser = await user.save()
    res.json(getAuthPayload(updatedUser))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
