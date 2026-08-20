const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const mongoSanitize = require('express-mongo-sanitize')
const cookieParser = require('cookie-parser')
const fs = require('fs')
const { randomUUID } = require('crypto')

const userRoutes = require('./routes/userRoutes')
const productRoutes = require('./routes/productRoutes')
const orderRoutes = require('./routes/orderRoutes')
const paystackRoutes = require('./routes/paystackRoutes')
const stripeRoutes = require('./routes/stripeRoutes')
const reviewRoutes = require('./routes/reviewRoutes')
const uploadRoutes = require('./routes/uploadRoutes')
const adminRoutes = require('./routes/adminRoutes')
const conversationRoutes = require('./routes/conversationRoutes')
const reportRoutes = require('./routes/reportRoutes')
const promotionRoutes = require('./routes/promotionRoutes')
const marketplaceRoutes = require('./routes/marketplaceRoutes')

const {
  generalLimiter,
  authLimiter,
  authAccountLimiter,
  otpLimiter,
  otpAccountLimiter,
  uploadLimiter,
  paymentLimiter,
  sanitizeInput,
  ipProtection,
  securityHeaders,
  hppProtection
} = require('./middleware/security')

const { httpLogger, logger, sanitizeErrorMessage } = require('./middleware/logger')
const { csrfProtection } = require('./middleware/csrf')
const { getAllowedOrigins, requireTrustedBrowserOrigin } = require('./utils/originPolicy')
const { assertProductionSecurityConfig } = require('./utils/runtimeSecurity')
const { releaseExpiredReservations } = require('./services/reservationService')
const { migrateLegacyProductReviews } = require('./services/reviewMigrationService')
const { migrateLegacyMarketplaceRecords } = require('./services/marketMigrationService')

const app = express()
app.disable('x-powered-by')

assertProductionSecurityConfig()
const allowedOrigins = getAllowedOrigins()

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }

    const corsError = new Error('Not allowed by CORS')
    corsError.status = 403
    return callback(corsError)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
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
app.use((req, res, next) => {
  req.requestId = String(req.get('x-request-id') || randomUUID()).slice(0, 100)
  res.setHeader('X-Request-ID', req.requestId)
  next()
})

// Individual route handlers may use contextual internal messages. Never allow one
// of those messages to become a production response with infrastructure details.
app.use((req, res, next) => {
  const json = res.json.bind(res)
  res.json = (payload) => {
    if (process.env.NODE_ENV === 'production' && res.statusCode >= 500 && payload?.message) {
      return json({ message: 'Something went wrong on our end.', requestId: req.requestId })
    }
    return json(payload)
  }
  next()
})
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
app.use(requireTrustedBrowserOrigin)

// Paystack signatures require the unparsed request bytes.
app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), paystackRoutes.handleWebhook)
// Stripe also verifies signatures against the exact request bytes.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeRoutes.handleWebhook)

// 6. Body parser
app.use(express.json({ limit: '256kb', strict: true }))
app.use(express.urlencoded({ extended: true, limit: '64kb', parameterLimit: 100 }))
app.use(cookieParser())

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

// Authenticated or financial data must never be shared through a browser or CDN cache.
app.use([
  '/api/users', '/api/admin', '/api/orders', '/api/upload', '/api/conversations',
  '/api/reports', '/api/reviews', '/api/paystack', '/api/stripe'
], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('Pragma', 'no-cache')
  next()
})

// Every state-changing API request must carry the matching CSRF token.
app.use('/api', csrfProtection)

// ── DATABASE ──
const connectDatabase = async () => {
  const mongoUri = process.env.MONGO_URI

  if (!mongoUri) {
    logger.error('MongoDB connection error: MONGO_URI is not configured')
    return
  }

  try {
    await mongoose.connect(mongoUri, {
      dbName: process.env.MONGO_DB_NAME || 'glory-store',
      serverSelectionTimeoutMS: 15000
    })
    logger.info('MongoDB connected successfully')
    const migrated = await migrateLegacyProductReviews()
    if (migrated) logger.info('Legacy product reviews migrated to verified-interaction reviews')
    const marketsMigrated = await migrateLegacyMarketplaceRecords()
    if (marketsMigrated) logger.info('Legacy marketplace records migrated to regional markets')
  } catch (err) {
    logger.error('MongoDB connection error:', err)
  }
}

connectDatabase()

// ── ROUTES WITH SPECIFIC LIMITERS ──
app.use('/api/users/login', authLimiter)
app.use('/api/users/login', authAccountLimiter)
app.use('/api/users/register', authLimiter)
app.use('/api/users/register', authAccountLimiter)
app.use('/api/users/google', authLimiter)
app.use('/api/users/verify-email', otpLimiter)
app.use('/api/users/verify-email', otpAccountLimiter)
app.use('/api/users/resend-verification', otpLimiter)
app.use('/api/users/resend-verification', otpAccountLimiter)
app.use('/api/users/2fa', otpLimiter)
app.use('/api/users/2fa', otpAccountLimiter)
app.use('/api/users', userRoutes)
app.use('/api/products', productRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/paystack', paymentLimiter, paystackRoutes)
app.use('/api/stripe', paymentLimiter, stripeRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/upload', uploadLimiter, uploadRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/promotions', promotionRoutes)
app.use('/api/marketplace', marketplaceRoutes)

app.get('/api/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'healthy' : 'degraded',
    service: 'glory-store-api',
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) || 'local',
    uptimeSeconds: Math.floor(process.uptime()),
    requestId: req.requestId,
    database: databaseConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  })
})

app.get('/api/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1
  res.status(ready ? 200 : 503).json({
    ready,
    database: mongoose.connection.readyState,
    requestId: req.requestId,
    timestamp: new Date().toISOString()
  })
})

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
    message: sanitizeErrorMessage(err.message),
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    requestId: req.requestId
  })

  // Don't leak error details in production
  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong on our end'
      : err.message
  })
})

const PORT = process.env.PORT || 5000
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')

const server = app.listen(PORT, HOST, () => {
  logger.info(`Glory Store server running on ${HOST}:${PORT}`)
})

server.requestTimeout = 30_000
server.headersTimeout = 35_000
server.keepAliveTimeout = 5_000
server.maxRequestsPerSocket = 1_000

const reservationTimer = setInterval(() => {
  releaseExpiredReservations().catch((error) => {
    logger.error({ type: 'RESERVATION_SWEEP_FAILED', message: error.message })
  })
}, 5 * 60 * 1000)
reservationTimer.unref()

process.on('unhandledRejection', (error) => {
  logger.error({
    type: 'UNHANDLED_REJECTION',
    message: sanitizeErrorMessage(error?.message),
    stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack
  })
})

process.on('uncaughtException', (error) => {
  logger.error({
    type: 'UNCAUGHT_EXCEPTION',
    message: sanitizeErrorMessage(error.message),
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  })
  server.close(() => process.exit(1))
  setTimeout(() => process.exit(1), 5000).unref()
})
