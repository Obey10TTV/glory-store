const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const mongoSanitize = require('express-mongo-sanitize')
const fs = require('fs')

const userRoutes = require('./routes/userRoutes')
const productRoutes = require('./routes/productRoutes')
const orderRoutes = require('./routes/orderRoutes')
const paystackRoutes = require('./routes/paystackRoutes')
const reviewRoutes = require('./routes/reviewRoutes')
const uploadRoutes = require('./routes/uploadRoutes')
const adminRoutes = require('./routes/adminRoutes')

const {
  generalLimiter,
  authLimiter,
  uploadLimiter,
  paymentLimiter,
  sanitizeInput,
  ipProtection,
  securityHeaders,
  hppProtection
} = require('./middleware/security')

const { httpLogger, logger } = require('./middleware/logger')

const app = express()
app.disable('x-powered-by')

const fallbackAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://glory-frontend-gray.vercel.app'
]

const configuredOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.CORS_ORIGINS
]
  .flatMap((value) => (value || '').split(','))
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean)

const allowedOrigins = [...new Set([...configuredOrigins, ...fallbackAllowedOrigins])]

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    return callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}

// ── CREATE LOGS DIRECTORY ──
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs')
}

// ── SECURITY MIDDLEWARE ──

// 1. Trust proxy (for Railway)
app.set('trust proxy', 1)

// 2. HTTP Logger
app.use(httpLogger)

// 3. Security headers
app.use(securityHeaders)

// 4. Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "https://images.pexels.com"],
      scriptSrc: ["'self'"],
    }
  }
}))

// 5. CORS
app.use(cors(corsOptions))

// 6. Body parser
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 7. MongoDB sanitize — NoSQL injection prevention
app.use(mongoSanitize())

// 8. XSS sanitization
app.use(sanitizeInput)

// 9. HPP — HTTP Parameter Pollution
app.use(hppProtection)

// 10. IP protection
app.use(ipProtection)

// 11. General rate limiter
app.use(generalLimiter)

// ── DATABASE ──
const connectDatabase = async () => {
  const mongoUri = process.env.MONGO_URI

  if (!mongoUri) {
    logger.error('MongoDB connection error: MONGO_URI is not configured')
    return
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000
    })
    logger.info('MongoDB connected successfully')
  } catch (err) {
    logger.error('MongoDB connection error:', err)
  }
}

connectDatabase()

// ── ROUTES WITH SPECIFIC LIMITERS ──
app.use('/api/users/login', authLimiter)
app.use('/api/users/register', authLimiter)
app.use('/api/users', userRoutes)
app.use('/api/products', productRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/paystack', paymentLimiter, paystackRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/upload', uploadLimiter, uploadRoutes)
app.use('/api/admin', adminRoutes)

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({
    message: 'Glory Store API is running',
    version: '1.0.0',
    status: 'healthy'
  })
})

// ── 404 HANDLER ──
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

// ── GLOBAL ERROR HANDLER ──
app.use((err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  })

  // Don't leak error details in production
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong on our end'
      : err.message
  })
})

const PORT = process.env.PORT || 5000
const HOST = process.env.HOST || '0.0.0.0'

app.listen(PORT, HOST, () => {
  logger.info(`Glory Store server running on ${HOST}:${PORT}`)
})
