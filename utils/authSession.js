const crypto = require('crypto')
const jwt = require('jsonwebtoken')

const ACCESS_COOKIE = 'glory_access'
const REFRESH_COOKIE = 'glory_refresh'
const CSRF_COOKIE = 'glory_csrf'
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m'
const REFRESH_DAYS = Math.max(1, Number(process.env.REFRESH_TOKEN_DAYS || 7))

const hashToken = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')

const cookieOptions = (httpOnly = true) => ({
  httpOnly,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
})

const createAccessToken = (userId, sessionId) => jwt.sign(
  { id: userId, sessionId, type: 'access' },
  process.env.JWT_SECRET,
  { expiresIn: ACCESS_TOKEN_TTL }
)

const createRefreshToken = () => crypto.randomBytes(48).toString('base64url')

const getDeviceLabel = (userAgent = '') => {
  const value = String(userAgent).slice(0, 240)
  if (/iphone|ipad/i.test(value)) return 'Apple mobile device'
  if (/android/i.test(value)) return 'Android device'
  if (/windows/i.test(value)) return 'Windows device'
  if (/macintosh|mac os/i.test(value)) return 'Mac device'
  return 'Browser session'
}

const createSession = (req) => {
  const refreshToken = createRefreshToken()
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000)
  const userAgent = String(req.get('user-agent') || '').slice(0, 240)
  const ipHash = hashToken(`${req.ip || ''}:${process.env.SESSION_IP_SALT || process.env.JWT_SECRET}`)

  return {
    refreshToken,
    session: {
      sessionId,
      tokenHash: hashToken(refreshToken),
      deviceLabel: getDeviceLabel(userAgent),
      userAgent,
      ipHash,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      expiresAt,
    }
  }
}

const setAuthCookies = (res, { userId, sessionId, refreshToken }) => {
  res.cookie(ACCESS_COOKIE, createAccessToken(userId, sessionId), {
    ...cookieOptions(true),
    maxAge: 15 * 60 * 1000,
  })
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(true),
    maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
  })
}

const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(true))
  res.clearCookie(REFRESH_COOKIE, cookieOptions(true))
  res.clearCookie(CSRF_COOKIE, cookieOptions(true))
}

const issueCsrfToken = (res) => {
  const token = crypto.randomBytes(32).toString('base64url')
  res.cookie(CSRF_COOKIE, token, {
    ...cookieOptions(true),
    maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
  })
  return token
}

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  hashToken,
  createAccessToken,
  createRefreshToken,
  createSession,
  setAuthCookies,
  clearAuthCookies,
  issueCsrfToken,
  safeEqual,
  cookieOptions,
}
