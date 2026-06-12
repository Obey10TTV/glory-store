const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/user')
const { protect } = require('../middleware/auth')
const {
  validateRegister,
  validateLogin,
  handleValidationErrors
} = require('../middleware/security')

// REGISTER
router.post('/register', validateRegister, handleValidationErrors, async (req, res) => {
  try {
    const { name, email, password, isSeller } = req.body
    const userExists = await User.findOne({ email })
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' })
    }
    const hashedPassword = await bcrypt.hash(password, 12)
    const user = await User.create({
      name, email,
      password: hashedPassword,
      isSeller: isSeller || false
    })
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' })
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isSeller: user.isSeller,
      isAdmin: user.isAdmin,
      token
    })
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
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' })
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isSeller: user.isSeller,
      isAdmin: user.isAdmin,
      token
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// MAKE SELF ADMIN
router.put('/makeadmin', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email })
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    user.isAdmin = true
    user.isSeller = true
    await user.save()
    res.json({ message: 'User is now admin and seller' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET PROFILE
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password')
    res.json(user)
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
      user.password = await bcrypt.hash(req.body.password, 12)
    }
    const updatedUser = await user.save()
    const token = jwt.sign({ id: updatedUser._id }, process.env.JWT_SECRET, { expiresIn: '30d' })
    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      isSeller: updatedUser.isSeller,
      isAdmin: updatedUser.isAdmin,
      token
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router