const DEFAULT_ISSUER = 'glory-store-api'
const DEFAULT_AUDIENCE = 'glory-web'

const getJwtConfig = () => ({
  issuer: String(process.env.JWT_ISSUER || DEFAULT_ISSUER).trim(),
  audience: String(process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE).trim(),
  algorithm: 'HS256'
})

const getJwtSigningOptions = () => {
  const { issuer, audience, algorithm } = getJwtConfig()
  return { issuer, audience, algorithm }
}

const getJwtVerificationOptions = () => {
  const { issuer, audience, algorithm } = getJwtConfig()
  return { issuer, audience, algorithms: [algorithm] }
}

const assertProductionSecurityConfig = () => {
  if (process.env.NODE_ENV !== 'production') return

  const jwtSecret = String(process.env.JWT_SECRET || '')
  const otpSecret = String(process.env.OTP_SECRET || '')
  const rateLimitSecret = String(process.env.RATE_LIMIT_KEY_SECRET || '')
  const logHashSecret = String(process.env.LOG_HASH_SECRET || '')
  const sessionIpSalt = String(process.env.SESSION_IP_SALT || '')
  const failures = []

  if (jwtSecret.length < 32) failures.push('JWT_SECRET must be at least 32 characters')
  if (otpSecret.length < 32) failures.push('OTP_SECRET must be at least 32 characters')
  if (rateLimitSecret.length < 32) failures.push('RATE_LIMIT_KEY_SECRET must be at least 32 characters')
  if (logHashSecret.length < 32) failures.push('LOG_HASH_SECRET must be at least 32 characters')
  if (sessionIpSalt.length < 32) failures.push('SESSION_IP_SALT must be at least 32 characters')
  if (otpSecret && otpSecret === jwtSecret) failures.push('OTP_SECRET must be different from JWT_SECRET')

  if (failures.length) {
    throw new Error(`Production security configuration invalid: ${failures.join('; ')}`)
  }
}

module.exports = {
  assertProductionSecurityConfig,
  getJwtConfig,
  getJwtSigningOptions,
  getJwtVerificationOptions
}
