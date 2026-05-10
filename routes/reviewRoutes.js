const express = require('express')
const router = express.Router()
const Product = require('../models/product')
const User = require('../models/user')
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

// ADD REVIEW - POST /api/reviews/:productId
router.post('/:productId', protect, async (req, res) => {
  try {
    const { rating, comment } = req.body
    const product = await Product.findById(req.params.productId)

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    const alreadyReviewed = product.reviews.find(
      r => r.user.toString() === req.user._id.toString()
    )

    if (alreadyReviewed) {
      return res.status(400).json({ message: 'You have already reviewed this product' })
    }

    const review = {
      user: req.user._id,
      name: req.user.name,
      rating: Number(rating),
      comment
    }

    product.reviews.push(review)
    product.numReviews = product.reviews.length
    product.rating = product.reviews.reduce((acc, r) => acc + r.rating, 0) / product.reviews.length

    await product.save()
    res.status(201).json({ message: 'Review added successfully' })

  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET ALL REVIEWS FOR A PRODUCT - GET /api/reviews/:productId
router.get('/:productId', async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(product.reviews)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE REVIEW - DELETE /api/reviews/:productId/:reviewId
router.delete('/:productId/:reviewId', protect, async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    product.reviews = product.reviews.filter(
      r => r._id.toString() !== req.params.reviewId
    )

    product.numReviews = product.reviews.length
    product.rating = product.reviews.length > 0
      ? product.reviews.reduce((acc, r) => acc + r.rating, 0) / product.reviews.length
      : 0

    await product.save()
    res.json({ message: 'Review deleted successfully' })

  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router