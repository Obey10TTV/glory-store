const express = require('express')
const router = express.Router()
const Product = require('../models/product')
const jwt = require('jsonwebtoken')

// Middleware to protect routes
const protect = async (req, res, next) => {
  let token
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1]
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      req.user = decoded
      next()
    } catch (error) {
      res.status(401).json({ message: 'Not authorized' })
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' })
  }
}

// GET ALL PRODUCTS - GET /api/products
router.get('/', async (req, res) => {
  try {
    const products = await Product.find({})
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// GET SINGLE PRODUCT - GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// CREATE PRODUCT - POST /api/products
router.post('/', protect, async (req, res) => {
  try {
    const { name, price, description, category, image, brand, countInStock } = req.body
    const product = await Product.create({
      name,
      price,
      description,
      category,
      image,
      brand,
      countInStock,
      seller: req.user.id
    })
    res.status(201).json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// UPDATE PRODUCT - PUT /api/products/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// DELETE PRODUCT - DELETE /api/products/:id
router.delete('/:id', protect, async (req, res) => {
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