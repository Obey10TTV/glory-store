const dotenv = require('dotenv')
dotenv.config()

const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const mongoSanitize = require('express-mongo-sanitize')

const userRoutes = require('./routes/userRoutes')
const productRoutes = require('./routes/productRoutes')
const orderRoutes = require('./routes/orderRoutes')
const paystackRoutes = require('./routes/paystackRoutes')
const reviewRoutes = require('./routes/reviewRoutes')
const uploadRoutes = require('./routes/uploadRoutes')
const adminRoutes = require('./routes/adminRoutes')

const app = express()

// ── SECURITY MIDDLEWARE ──

// 1. Helmet — sets secure HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

// 2. CORS — only allow our frontend
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://glory-frontend-gray.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// 3. Body parser
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 4. MongoDB sanitize — prevent NoSQL injection
app.use(mongoSanitize())

// 5. General rate limiter — max 100 requests per 15 minutes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})
app.use(generalLimiter)

// 6. Strict rate limiter for auth routes — max 10 attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})

// ── DATABASE ──
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => console.log('MongoDB connection error:', err))

// ── ROUTES ──
app.use('/api/users/login', authLimiter)
app.use('/api/users/register', authLimiter)
app.use('/api/users', userRoutes)
app.use('/api/products', productRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/paystack', paystackRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/upload', uploadRoutes)
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
  console.error(err.stack)
  res.status(err.status || 500).json({
    message: err.message || 'Something went wrong on our end',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`Glory Store server running on port ${PORT}`)
})
