const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const User = require('../models/user')
const Order = require('../models/order')
const Product = require('../models/product')
const Review = require('../models/review')
const { protect } = require('../middleware/auth')
const {
  validateRegister,
  validateLogin,
  validateGoogleAuth,
  validateGoogleLink,
  validateEmailOtp,
  validateEmailOnly,
  validateOtpOnly,
  validateSecondFactor,
  validateSellerProfile,
  validateUpdateProfile,
  handleValidationErrors
} = require('../middleware/security')
const {
  generateOtp,
  createOtpChallenge,
  isInCooldown,
  verifyOtpChallenge,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode
} = require('../utils/otp')
const { getGoogleAuthOptions, verifyGoogleCredential } = require('../utils/googleAuth')
const { sendOtpEmail, sendPrivacyRequestEmail } = require('../utils/email')
const { recordAudit } = require('../utils/audit')
const { getRequiredSellerDocumentTypes, hasVerifiedSellerIdentity } = require('../utils/sellerVerification')
const {
  REFRESH_COOKIE,
  clearAuthCookies,
  createRefreshToken,
  createSession,
  hashToken,
  issueCsrfToken,
  setAuthCookies,
} = require('../utils/authSession')

// Admin-only middleware for this file
const adminOnly = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    return next()
  }

  return res.status(403).json({ message: 'Not authorized as admin' })
}

const getAuthPayload = (user) => {
  const safeUser = typeof user.toJSON === 'function' ? user.toJSON() : user
  return {
    _id: safeUser._id,
    name: safeUser.name,
    email: safeUser.email,
    isSeller: safeUser.isSeller,
    isAdmin: safeUser.isAdmin,
    isEmailVerified: safeUser.isEmailVerified !== false,
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
    sellerProfile: safeUser.sellerProfile,
    privacy: safeUser.privacy
  }
}

const establishSession = async (user, req, res) => {
  const now = Date.now()
  user.authSessions = (user.authSessions || [])
    .filter((session) => new Date(session.expiresAt).getTime() > now)
    .slice(-4)

  const { refreshToken, session } = createSession(req)
  user.authSessions.push(session)
  await user.save()
  setAuthCookies(res, { userId: user._id, sessionId: session.sessionId, refreshToken })
}

const completeAuthentication = async (user, req, res) => {
  if (user.twoFactor?.enabled) {
    await sendTwoFactorLoginCode(user)
    return res.json({
      requiresTwoFactor: true,
      email: user.email,
      message: 'Enter the verification code sent to your email.'
    })
  }

  await establishSession(user, req, res)
  return res.json(getAuthPayload(user))
}

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

const requiredSellerProfileFields = ['brandName', 'storeName', 'businessEmail', 'phone', 'city', 'province']

const isSellerProfileComplete = (sellerProfile = {}) => (
  requiredSellerProfileFields.every((field) => String(sellerProfile[field] || '').trim().length > 0)
)

// CSRF BOOTSTRAP
router.get('/csrf', (req, res) => {
  res.json({ csrfToken: issueCsrfToken(res) })
})

// Google client IDs are public identifiers. The credential itself is still verified server-side.
router.get('/auth-options', (req, res) => {
  res.json({ google: getGoogleAuthOptions() })
})

// ROTATE REFRESH SESSION
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    if (!refreshToken) {
      clearAuthCookies(res)
      return res.status(401).json({ message: 'Refresh session is missing' })
    }

    const tokenHash = hashToken(refreshToken)
    const user = await User.findOne({
      authSessions: {
        $elemMatch: { tokenHash, expiresAt: { $gt: new Date() } }
      }
    })

    if (!user) {
      clearAuthCookies(res)
      return res.status(401).json({ message: 'Refresh session has expired' })
    }

    const session = user.authSessions.find((item) => item.tokenHash === tokenHash)
    const rotatedToken = createRefreshToken()
    session.tokenHash = hashToken(rotatedToken)
    session.lastUsedAt = new Date()
    await user.save()
    setAuthCookies(res, {
      userId: user._id,
      sessionId: session.sessionId,
      refreshToken: rotatedToken
    })

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE]
    if (refreshToken) {
      await User.updateOne(
        { 'authSessions.tokenHash': hashToken(refreshToken) },
        { $pull: { authSessions: { tokenHash: hashToken(refreshToken) } } }
      )
    }
    clearAuthCookies(res)
    res.json({ message: 'Signed out securely' })
  } catch (error) {
    clearAuthCookies(res)
    handleRouteError(res, error)
  }
})

// REGISTER
router.post('/register', validateRegister, handleValidationErrors, async (req, res) => {
  try {
    const { name, email, password, isSeller, brandName } = req.body

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
      isEmailVerified: false,
      sellerProfile: isSeller ? {
        brandName: String(brandName || '').trim()
      } : undefined
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

    await establishSession(user, req, res)
    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

// GOOGLE SIGN-UP AND SIGN-IN
router.post('/google', validateGoogleAuth, handleValidationErrors, async (req, res) => {
  try {
    const profile = await verifyGoogleCredential(req.body.credential)
    let user = await User.findOne({ googleSubject: profile.subject }).select('+googleSubject')

    if (!user) {
      const emailAccount = await User.findOne({ email: profile.email }).select('+googleSubject')

      if (emailAccount) {
        return res.status(409).json({
          requiresGoogleLink: true,
          email: profile.email,
          message: 'This email already has a Glory account. Enter its password once to link Google securely.'
        })
      }

      user = await User.create({
        name: profile.name,
        email: profile.email,
        googleSubject: profile.subject,
        avatar: profile.avatar,
        isEmailVerified: true,
        isSeller: req.body.isSeller === true,
        sellerProfile: req.body.isSeller === true ? {
          brandName: String(req.body.brandName || '').trim()
        } : undefined
      })
    } else {
      if (user.isEmailVerified === false) {
        user.isEmailVerified = true
        user.emailVerification = {}
      }
      if (!user.avatar && profile.avatar) {
        user.avatar = profile.avatar
      }
      if (user.isModified()) {
        await user.save()
      }
    }

    return completeAuthentication(user, req, res)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'A Glory account already uses this Google identity.' })
    }
    return handleRouteError(res, error)
  }
})

// LINK GOOGLE TO AN EXISTING PASSWORD ACCOUNT
router.post('/google/link', validateGoogleLink, handleValidationErrors, async (req, res) => {
  try {
    const profile = await verifyGoogleCredential(req.body.credential)
    const user = await User.findOne({ email: profile.email }).select('+googleSubject')

    if (!user || !user.password) {
      return res.status(401).json({ message: 'Account linking could not be verified.' })
    }

    if (user.googleSubject && user.googleSubject !== profile.subject) {
      return res.status(409).json({ message: 'This account is already linked to another Google identity.' })
    }

    if (!(await user.matchPassword(req.body.password))) {
      return res.status(401).json({ message: 'Account linking could not be verified.' })
    }

    user.googleSubject = profile.subject
    user.isEmailVerified = true
    user.emailVerification = {}
    if (!user.avatar && profile.avatar) {
      user.avatar = profile.avatar
    }
    await user.save()

    return completeAuthentication(user, req, res)
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'This Google identity is already linked to another account.' })
    }
    return handleRouteError(res, error)
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

    await establishSession(user, req, res)
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
router.post('/2fa/verify-login', validateSecondFactor, handleValidationErrors, async (req, res) => {
  try {
    const { email, otp } = req.body
    const user = await User.findOne({ email })

    if (!user || !user.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Verification code is invalid.' })
    }

    const isOtp = /^\d{6}$/.test(otp)
    const recoveryResult = isOtp
      ? null
      : consumeRecoveryCode(user.twoFactor.recoveryCodeHashes || [], otp)
    const result = isOtp
      ? verifyOtpChallenge(user.twoFactor.login, otp)
      : { valid: recoveryResult.valid, message: 'Recovery code is invalid or has already been used.' }
    if (!result.valid) {
      await user.save()
      return res.status(400).json({ message: result.message })
    }

    if (recoveryResult?.valid) {
      user.twoFactor.recoveryCodeHashes = recoveryResult.hashes
    }
    user.twoFactor.login = {}
    await establishSession(user, req, res)
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
    const recoveryCodes = generateRecoveryCodes()
    user.twoFactor.recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode)
    await user.save()

    res.json({ ...getAuthPayload(user), recoveryCodes })
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
    user.twoFactor.recoveryCodeHashes = []
    await user.save()

    res.json(getAuthPayload(user))
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.post('/2fa/recovery/start', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user?.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Enable two-factor authentication first.' })
    }
    ensureTwoFactor(user)
    await sendChallenge(
      user,
      user.twoFactor.pending,
      (challenge) => { user.twoFactor.pending = challenge },
      'recovery-2fa'
    )
    res.json({ message: 'We sent a code to confirm recovery code regeneration.' })
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.post('/2fa/recovery/confirm', protect, validateOtpOnly, handleValidationErrors, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user?.twoFactor?.enabled) {
      return res.status(400).json({ message: 'Enable two-factor authentication first.' })
    }
    const result = verifyOtpChallenge(user.twoFactor.pending, req.body.otp)
    if (!result.valid) {
      await user.save()
      return res.status(400).json({ message: result.message })
    }
    const recoveryCodes = generateRecoveryCodes()
    user.twoFactor.recoveryCodeHashes = recoveryCodes.map(hashRecoveryCode)
    user.twoFactor.pending = {}
    await user.save()
    res.json({ message: 'New recovery codes created.', recoveryCodes })
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

router.get('/sessions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('authSessions')
    const sessions = (user?.authSessions || [])
      .filter((session) => new Date(session.expiresAt).getTime() > Date.now())
      .map((session) => ({
        sessionId: session.sessionId,
        deviceLabel: session.deviceLabel,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        current: session.sessionId === req.authSessionId
      }))
      .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt))
    res.json(sessions)
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.delete('/sessions/:sessionId', protect, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { authSessions: { sessionId: req.params.sessionId } } }
    )
    if (req.params.sessionId === req.authSessionId) {
      clearAuthCookies(res)
    }
    res.json({ message: 'Session revoked' })
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.delete('/sessions', protect, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { authSessions: [] } })
    clearAuthCookies(res)
    res.json({ message: 'All sessions revoked' })
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.get('/privacy/export', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    const [orders, products, reviews] = await Promise.all([
      Order.find({ buyer: user._id }).sort({ createdAt: -1 }).lean(),
      Product.find({ seller: user._id }).sort({ createdAt: -1 }).lean(),
      Review.find({ reviewer: user._id })
        .select('listing rating comment verifiedInteraction status publishedAt createdAt')
        .populate('listing', 'name')
        .sort({ createdAt: -1 })
        .lean()
    ])
    user.privacy.exportRequestedAt = new Date()
    await user.save()
    await recordAudit(req, {
      action: 'privacy_export_created', entityType: 'privacy', entityId: user._id.toString(),
      summary: 'User downloaded a personal data export'
    })

    res.setHeader('Content-Disposition', `attachment; filename="glory-data-${user._id}.json"`)
    res.json({
      exportedAt: new Date().toISOString(),
      account: user.toObject(),
      orders: orders.map(order => {
        const {
          sellerAllocations,
          platformFeeTotalPence,
          processorFeePence,
          platformNetPence,
          paymentSourceId,
          transferGroup,
          ...buyerOrder
        } = order
        return {
          ...buyerOrder,
          supportNotes: (order.supportNotes || []).filter(note => note.visibility !== 'admin')
        }
      }),
      sellerProducts: products,
      reviews
    })
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.post('/privacy/deletion-request', protect, async (req, res) => {
  try {
    const password = String(req.body.password || '')
    const user = await User.findById(req.user._id)
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Enter your current password to confirm this request' })
    }
    const activeOrders = await Order.countDocuments({
      buyer: user._id,
      status: { $in: ['Pending', 'Processing', 'Shipped', 'CancellationRequested'] }
    })
    if (activeOrders > 0) {
      return res.status(409).json({ message: 'Resolve active orders before requesting account deletion' })
    }
    user.privacy.deletionRequestedAt = new Date()
    user.privacy.deletionStatus = 'pending'
    await user.save()
    await recordAudit(req, {
      action: 'privacy_deletion_requested', entityType: 'privacy', entityId: user._id.toString(),
      summary: 'User requested account deletion'
    })
    await sendPrivacyRequestEmail({ to: user.email, name: user.name, action: 'requested' })
    res.json({ message: 'Deletion request received', privacy: user.privacy })
  } catch (error) {
    handleRouteError(res, error)
  }
})

router.delete('/privacy/deletion-request', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    user.privacy.deletionStatus = 'cancelled'
    await user.save()
    await recordAudit(req, {
      action: 'privacy_deletion_cancelled', entityType: 'privacy', entityId: user._id.toString(),
      summary: 'User cancelled account deletion request'
    })
    await sendPrivacyRequestEmail({ to: user.email, name: user.name, action: 'cancelled' })
    res.json({ message: 'Deletion request cancelled', privacy: user.privacy })
  } catch (error) {
    handleRouteError(res, error)
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

    const hasBrandNameUpdate = Object.prototype.hasOwnProperty.call(req.body, 'brandName')
    const previousBrandName = String(user.sellerProfile.brandName || '').trim()
    const requestedBrandName = String(req.body.brandName || '').trim()
    if (hasBrandNameUpdate && requestedBrandName.length < 2) {
      return res.status(400).json({ message: 'Brand name must be between 2 and 80 characters.' })
    }

    const allowedFields = [
      'brandName',
      'storeName',
      'bio',
      'businessEmail',
      'phone',
      'city',
      'province',
      'country',
      'website',
      'instagram',
      'businessType',
      'taxStatus',
      'returnPolicy',
      'returnPolicyDetail',
      'responseTimeCommitment',
      'acceptedPaymentMethods'
    ]

    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        user.sellerProfile[field] = req.body[field]
      }
    })

    if (req.body.submitForReview) {
      if (!isSellerProfileComplete(user.sellerProfile)) {
        return res.status(400).json({
          message: 'Please complete store name, business email, phone, city and county or region before submitting for verification.'
        })
      }

      if (!hasVerifiedSellerIdentity(user.sellerProfile)) {
        return res.status(400).json({
          message: 'Complete the hosted government photo-ID check before submitting your seller profile.'
        })
      }

      const requiredDocumentTypes = getRequiredSellerDocumentTypes(user.sellerProfile)
      const uploadedTypes = new Set((user.sellerProfile.documents || []).map(document => document.type))
      const missingDocuments = requiredDocumentTypes.filter(type => !uploadedTypes.has(type))
      if (missingDocuments.length) {
        return res.status(400).json({
          message: `Upload all required verification documents first: ${missingDocuments.join(', ')}`
        })
      }

      if (user.sellerProfile.verificationStatus !== 'verified') {
        user.sellerProfile.verificationStatus = 'pending'
        user.sellerProfile.submittedAt = new Date()
        user.sellerProfile.reviewedAt = undefined
        user.sellerProfile.verificationNote = ''
        user.sellerProfile.auditTrail.push({
          action: 'seller_submitted',
          note: 'Seller submitted profile and documents for review.',
          actor: user._id
        })
      }
    }

    const updatedUser = await user.save()
    if (hasBrandNameUpdate && requestedBrandName !== previousBrandName) {
      // A seller owns one buyer-facing brand. Keep their existing catalogue searchable under it.
      await Product.updateMany(
        { seller: updatedUser._id },
        { $set: { brand: requestedBrandName } }
      )
    }
    res.json(getAuthPayload(updatedUser))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// UPDATE PROFILE
router.put('/profile', protect, validateUpdateProfile, handleValidationErrors, async (req, res) => {
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
