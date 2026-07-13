const express = require('express')
const router = express.Router()
const Product = require('../models/product')
const Order = require('../models/order')
const { protect } = require('../middleware/auth')


// ADD REVIEW - POST /api/reviews/:productId
router.post('/:productId', protect, async (req, res) => {
  try {
    const rating = Number(req.body.rating)
    const comment = String(req.body.comment || '').trim()

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be a whole number between 1 and 5' })
    }

    if (comment.length < 10 || comment.length > 1000) {
      return res.status(400).json({ message: 'Review must be between 10 and 1000 characters' })
    }

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

    const verifiedOrder = await Order.exists({
      buyer: req.user._id,
      'orderItems.product': product._id,
      $or: [{ isPaid: true }, { isDelivered: true }]
    })

    if (!verifiedOrder) {
      return res.status(403).json({ message: 'Only verified purchasers can review this product' })
    }

    const review = {
      user: req.user._id,
      name: req.user.name,
      rating,
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

    const review = product.reviews.id(req.params.reviewId)
    if (!review) {
      return res.status(404).json({ message: 'Review not found' })
    }

    const ownsReview = review.user.toString() === req.user._id.toString()
    if (!ownsReview && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized to delete this review' })
    }

    product.reviews.pull(review._id)

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
