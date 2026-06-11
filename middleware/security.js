const rateLimit = require('express-rate-limit')
const mongoSanitize = require('express-mongo-sanitize')
const hpp = require('hpp')
const xss = require('xss')
const { body, validationResult } = require('express-validator')

// ── 1. ENHANCED RATE LIMITERS ──

// General API limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' // skip localhost
})

// Strict auth limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
})

// Upload limiter
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { message: 'Too many uploads, please try again after an hour.' }
})

// Payment limiter
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { message: 'Too many payment attempts, please try again later.' }
})

// ── 2. XSS PROTECTION ──
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss(req.body[key])
      }
    })
  }
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = xss(req.query[key])
      }
    })
  }
  if (req.params) {
    Object.keys(req.params).forEach(key => {
      if (typeof req.params[key] === 'string') {
        req.params[key] = xss(req.params[key])
      }
    })
  }
  next()
}

// ── 3. SUSPICIOUS IP DETECTION ──
const suspiciousIPs = new Set()
const requestCounts = new Map()

const ipProtection = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress

  // Block known suspicious IPs
  if (suspiciousIPs.has(ip)) {
    return res.status(403).json({ message: 'Access denied.' })
  }

  // Track request patterns
  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, [])
  }
  
  const requests = requestCounts.get(ip).filter(time => now - time < windowMs)
  requests.push(now)
  requestCounts.set(ip, requests)

  // Flag IP if more than 200 requests per minute
  if (requests.length > 200) {
    suspiciousIPs.add(ip)
    console.warn(`Suspicious IP flagged: ${ip}`)
    return res.status(429).json({ message: 'Unusual activity detected. Access temporarily blocked.' })
  }

  next()
}

// ── 4. INPUT VALIDATION RULES ──
const validateRegister = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .matches(/\d/)
    .withMessage('Password must contain at least one number'),
]

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
]

const validateProduct = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  body('price')
    .isNumeric()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Description must be between 10 and 2000 characters'),
  body('category')
    .isIn([
      'Skincare', 'Haircare', 'Makeup', 'Nails', 'Lashes',
      'Body Care', 'Body Liquid', 'Fragrance', 'Scented Candles',
      'Tools & Accessories'
    ])
    .withMessage('Invalid category'),
  body('countInStock')
    .isInt({ min: 0 })
    .withMessage('Stock must be a non-negative integer'),
]

const validateOrder = [
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Order must have at least one item'),
  body('shippingAddress.fullName')
    .trim()
    .notEmpty()
    .withMessage('Full name is required'),
  body('shippingAddress.phone')
    .matches(/^(\+234|0)[789][01]\d{8}$/)
    .withMessage('Please provide a valid Nigerian phone number'),
  body('paymentMethod')
    .isIn(['Paystack', 'PayOnDelivery', 'Crypto'])
    .withMessage('Invalid payment method'),
  body('totalPrice')
    .isNumeric()
    .isFloat({ min: 0 })
    .withMessage('Total price must be a positive number'),
]

// ── 5. VALIDATION ERROR HANDLER ──
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    })
  }
  next()
}

// ── 6. SECURITY HEADERS ──
const securityHeaders = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY')
  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block')
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  next()
}

// ── 7. HPP PROTECTION ──
const hppProtection = hpp({
  whitelist: ['price', 'rating', 'category']
})

module.exports = {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  paymentLimiter,
  sanitizeInput,
  ipProtection,
  validateRegister,
  validateLogin,
  validateProduct,
  validateOrder,
  handleValidationErrors,
  securityHeaders,
  hppProtection
}