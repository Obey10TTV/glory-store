const { CSRF_COOKIE, safeEqual } = require('../utils/authSession')

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next()
  }

  if (req.originalUrl === '/api/paystack/webhook') {
    return next()
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE]
  const headerToken = req.get('x-csrf-token')

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return res.status(403).json({ message: 'Security token is missing or expired. Refresh and try again.' })
  }

  return next()
}

module.exports = { csrfProtection }
