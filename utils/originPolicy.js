const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001'
]

const PRODUCTION_ORIGINS = ['https://glory-ca.vercel.app']

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '')

const configuredOrigins = (env = process.env) => [
  env.CLIENT_ORIGIN,
  env.CLIENT_URL,
  env.FRONTEND_URL,
  env.CORS_ORIGIN,
  env.CORS_ORIGINS
]
  .flatMap((value) => String(value || '').split(','))
  .map(normalizeOrigin)
  .filter(Boolean)

const getAllowedOrigins = (env = process.env) => {
  const configured = configuredOrigins(env)
  const defaults = env.NODE_ENV === 'production' ? PRODUCTION_ORIGINS : LOCAL_ORIGINS
  return [...new Set([...defaults, ...configured])]
}

const isAllowedOrigin = (origin, env = process.env) => getAllowedOrigins(env).includes(normalizeOrigin(origin))

const requireTrustedBrowserOrigin = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

  // Webhooks are authenticated using the provider's signed raw body, not a browser Origin.
  if (['/api/paystack/webhook', '/api/stripe/webhook'].includes(req.originalUrl)) return next()

  const origin = req.get('origin')
  if (!origin || isAllowedOrigin(origin)) return next()

  return res.status(403).json({ message: 'This request origin is not allowed.' })
}

module.exports = { getAllowedOrigins, isAllowedOrigin, requireTrustedBrowserOrigin }
