const jwt = require('jsonwebtoken')
const User = require('../models/user')
const { ACCESS_COOKIE } = require('../utils/authSession')

// Protect any route - must be logged in
const protect = async (req, res, next) => {
  const cookieToken = req.cookies?.[ACCESS_COOKIE]
  const token = cookieToken

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      if (decoded.type && decoded.type !== 'access') {
        return res.status(401).json({ message: 'Not authorized, invalid token type' })
      }
      req.user = await User.findById(decoded.id).select(
        '-password -emailVerification -twoFactor.pending -twoFactor.login -twoFactor.disable'
      )
      if (!req.user) {
        return res.status(401).json({ message: 'User not found' })
      }

      if (!decoded.sessionId) {
        return res.status(401).json({ message: 'Session has expired' })
      }
      const activeSession = req.user.authSessions?.find(
        (session) => session.sessionId === decoded.sessionId
          && new Date(session.expiresAt).getTime() > Date.now()
      )
      if (!activeSession) {
        return res.status(401).json({ message: 'Session has expired' })
      }
      req.authSessionId = decoded.sessionId
      next()
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' })
    }
  } else {
    return res.status(401).json({ message: 'Not authorized, no token' })
  }
}

// Admin only
const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next()
  } else {
    res.status(403).json({ message: 'Not authorized as admin' })
  }
}

// Seller only
const seller = (req, res, next) => {
  if (req.user && (req.user.isSeller || req.user.isAdmin)) {
    next()
  } else {
    res.status(403).json({ message: 'Not authorized as seller' })
  }
}

// Product submissions are limited to sellers who completed the full trust flow.
const verifiedSeller = (req, res, next) => {
  if (req.user?.isAdmin) {
    return next()
  }

  if (!req.user?.isSeller) {
    return res.status(403).json({ message: 'Not authorized as seller' })
  }

  if (req.user.isEmailVerified === false) {
    return res.status(403).json({ message: 'Verify your email before managing products.' })
  }

  if (req.user.sellerProfile?.verificationStatus !== 'verified') {
    return res.status(403).json({ message: 'Your seller profile must be verified before submitting products.' })
  }

  if (!req.user.twoFactor?.enabled) {
    return res.status(403).json({ message: 'Enable two-factor authentication before managing products.' })
  }

  return next()
}

module.exports = { protect, admin, seller, verifiedSeller }
