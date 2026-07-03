const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/user')
const { protect } = require('../middleware/auth')
const {
  validateRegister,
  validateLogin,
  validateSellerProfile,
  handleValidationErrors
} = require('../middleware/security')

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
  sellerProfile: user.sellerProfile,
  token: generateToken(user._id)
})

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
      return res.status(400).json({ message: 'User already exists' })
    }

    const user = await User.create({
      name,
      email,
      password,
      isSeller: isSeller || false
    })

    res.status(201).json(getAuthPayload(user))
  } catch (error) {
    res.status(500).json({ message: error.message })
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

    res.json(getAuthPayload(user))
  } catch (error) {
    res.status(500).json({ message: error.message })
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
    user.email = req.body.email || user.email

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
