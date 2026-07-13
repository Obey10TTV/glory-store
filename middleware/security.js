const rateLimit = require('express-rate-limit')
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

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: { message: 'Too many verification attempts, please try again after 10 minutes.' },
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
const sanitizeValue = (value) => {
  if (typeof value === 'string') {
    return xss(value)
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }

  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      value[key] = sanitizeValue(value[key])
    })
  }

  return value
}

const sanitizeInput = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeValue(req.body)
  }
  if (req.query) {
    req.query = sanitizeValue(req.query)
  }
  if (req.params) {
    req.params = sanitizeValue(req.params)
  }
  next()
}

// ── 3. SUSPICIOUS IP DETECTION ──
const blockedIPs = new Map()
const requestCounts = new Map()

const ipProtection = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress

  const blockedUntil = blockedIPs.get(ip)
  if (blockedUntil && blockedUntil > Date.now()) {
    return res.status(429).json({ message: 'Unusual activity detected. Please try again later.' })
  }
  if (blockedUntil) {
    blockedIPs.delete(ip)
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
    blockedIPs.set(ip, now + (15 * 60 * 1000))
    requestCounts.delete(ip)
    console.warn(`Suspicious IP temporarily blocked: ${ip}`)
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
    .isLength({ min: 10, max: 128 })
    .withMessage('Password must be between 10 and 128 characters')
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .matches(/\d/)
    .withMessage('Password must contain at least one number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain a special character'),
]

const validateUpdateProfile = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 10, max: 128 })
    .withMessage('Password must be between 10 and 128 characters')
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .matches(/\d/)
    .withMessage('Password must contain at least one number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain a special character'),
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

const validateEmailOtp = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('otp')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Verification code must be 6 digits'),
]

const validateEmailOnly = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
]

const validateOtpOnly = [
  body('otp')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Verification code must be 6 digits'),
]

const validateSecondFactor = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('otp')
    .trim()
    .custom((value) => /^\d{6}$/.test(value) || /^[A-F0-9]{6}-[A-F0-9]{6}$/i.test(value))
    .withMessage('Enter a 6-digit code or a valid recovery code'),
]

const validateProduct = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  body('price')
    .isNumeric()
    .isFloat({ min: 0.01 })
    .withMessage('Price must be a positive number'),
  body('compareAtPrice')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0.01 })
    .withMessage('Compare-at price must be a positive number')
    .custom((value, { req }) => Number(value) > Number(req.body.price))
    .withMessage('Compare-at price must be higher than the selling price'),
  body('sku')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 64 })
    .withMessage('SKU must be 64 characters or less'),
  body('size')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Size must be 80 characters or less'),
  body('productType')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product type must be between 2 and 100 characters'),
  body('countryOfOrigin')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Country of origin must be between 2 and 100 characters'),
  body('barcode')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[A-Za-z0-9-]{4,64}$/)
    .withMessage('Barcode must contain 4 to 64 letters, numbers, or dashes'),
  body('brand')
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('Brand must be between 2 and 80 characters'),
  body('image')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Product image must be a valid URL'),
  body('images')
    .isArray({ min: 1, max: 6 })
    .withMessage('Add at least 1 and up to 6 gallery images'),
  body('images.*')
    .optional()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Every gallery image must be a valid URL'),
  body('variants')
    .optional()
    .isArray({ max: 30 })
    .withMessage('A product can have up to 30 variants'),
  body('variants.*.name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Variant names must be 100 characters or less'),
  body('variants.*.sku')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 64 })
    .withMessage('Variant SKUs must be 64 characters or less'),
  body('variants.*.price')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0.01 })
    .withMessage('Variant prices must be positive'),
  body('variants.*.countInStock')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Variant stock must be a non-negative integer'),
  body('variants.*.image')
    .optional({ checkFalsy: true })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Variant images must be valid URLs'),
  body('description')
    .trim()
    .isLength({ min: 40, max: 2000 })
    .withMessage('Description must be between 40 and 2000 characters'),
  body('ingredients')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Ingredients must be 2000 characters or less'),
  body('howToUse')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1200 })
    .withMessage('How to use must be 1200 characters or less'),
  body('keyBenefits')
    .isArray({ min: 2, max: 8 })
    .withMessage('Add between 2 and 8 key benefits'),
  body('keyBenefits.*')
    .optional()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Each benefit must be between 2 and 120 characters'),
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
  body('lowStockThreshold')
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage('Low-stock threshold must be between 0 and 1000'),
]

const validateOrder = [
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Order must have at least one item'),
  body('orderItems.*.product')
    .isMongoId()
    .withMessage('Each order item must reference a valid product'),
  body('orderItems.*.variantId')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Each selected variant must be valid'),
  body('orderItems.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Each order item must have a valid quantity'),
  body('shippingAddress.fullName')
    .trim()
    .notEmpty()
    .withMessage('Full name is required'),
  body('shippingAddress.address')
    .trim()
    .notEmpty()
    .withMessage('Street address is required'),
  body('shippingAddress.city')
    .trim()
    .notEmpty()
    .withMessage('City is required'),
  body('shippingAddress.state')
    .trim()
    .notEmpty()
    .withMessage('Province or state is required'),
  body('shippingAddress.postalCode')
    .trim()
    .isLength({ min: 3, max: 12 })
    .withMessage('Postal code is required'),
  body('shippingAddress.phone')
    .matches(/^(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/)
    .withMessage('Please provide a valid phone number'),
  body('paymentMethod')
    .isIn(['Paystack', 'PayOnDelivery'])
    .withMessage('Invalid payment method'),
]

const validateSellerProfile = [
  body('storeName')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('Store name must be between 2 and 80 characters'),
  body('bio')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 600 })
    .withMessage('Store bio must be 600 characters or less'),
  body('businessEmail')
    .optional({ checkFalsy: true })
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid business email'),
  body('phone')
    .optional({ checkFalsy: true })
    .matches(/^(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/)
    .withMessage('Please provide a valid phone number'),
  body('city')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('City must be 80 characters or less'),
  body('province')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Province must be 80 characters or less'),
  body('country')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Country must be 80 characters or less'),
  body('website')
    .optional({ checkFalsy: true })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Website must be a valid URL starting with http:// or https://'),
  body('instagram')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Instagram handle must be 80 characters or less'),
  body('submitForReview')
    .optional()
    .isBoolean()
    .withMessage('submitForReview must be true or false')
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
  // Disable legacy browser XSS filters that can introduce edge-case issues.
  res.setHeader('X-XSS-Protection', '0')
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  // Isolate browsing contexts for modern browsers.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  next()
}

// ── 7. HPP PROTECTION ──
const hppProtection = hpp({
  whitelist: ['price', 'rating', 'category']
})

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  uploadLimiter,
  paymentLimiter,
  sanitizeInput,
  ipProtection,
  validateRegister,
  validateUpdateProfile,
  validateLogin,
  validateEmailOtp,
  validateEmailOnly,
  validateOtpOnly,
  validateSecondFactor,
  validateProduct,
  validateSellerProfile,
  validateOrder,
  handleValidationErrors,
  securityHeaders,
  hppProtection
}
