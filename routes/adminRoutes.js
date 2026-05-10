const express = require('express')
const router = express.Router()
const User = require('../models/user')
const Product = require('../models/product')
const Order = require('../models/order')
const jwt = require('jsonwebtoken')

// Middleware to protect routes
const protect = async (req, res, next) => {
  let token
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1]
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.id)
      req.user = user
      next()
    } catch (error) {
      res.status(401).json({ message: 'Not authorized' })
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' })
  }
}

// Admin middleware
const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next()
  } else {
    res.status(401).json({ message: 'Not authorized as admin' })
  }
}

// GET ALL USERS - GET /api/admin/users
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}).select('-password')
    res.json(users)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE USER - DELETE /api/admin/users/:id
router.delete('/users/:id', protect, admin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    res.json({ message: 'User deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// MAKE USER ADMIN - PUT /api/admin/users/:id/makeadmin
router.put('/users/:id/makeadmin', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    user.isAdmin = true
    await user.save()
    res.json({ message: 'User is now an admin' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// MAKE USER SELLER - PUT /api/admin/users/:id/makeseller
router.put('/users/:id/makeseller', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }
    user.isSeller = true
    await user.save()
    res.json({ message: 'User is now a seller' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET ALL ORDERS - GET /api/admin/orders
router.get('/orders', protect, admin, async (req, res) => {
  try {
    const orders = await Order.find({}).populate('buyer', 'name email')
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET DASHBOARD STATS - GET /api/admin/stats
router.get('/stats', protect, admin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments()
    const totalProducts = await Product.countDocuments()
    const totalOrders = await Order.countDocuments()
    const totalRevenue = await Order.aggregate([
      { $match: { isPaid: true } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ])

    res.json({
      totalUsers,
      totalProducts,
      totalOrders,
      totalRevenue: totalRevenue[0] ? totalRevenue[0].total : 0
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE PRODUCT - DELETE /api/admin/products/:id
router.delete('/products/:id', protect, admin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json({ message: 'Product deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router