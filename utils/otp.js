const crypto = require('crypto')

const OTP_LENGTH = 6
const OTP_EXPIRY_MINUTES = 10
const OTP_MAX_ATTEMPTS = 5

const getOtpSecret = () => process.env.OTP_SECRET || process.env.JWT_SECRET || 'glory-local-otp-secret'

const generateOtp = () => String(crypto.randomInt(100000, 1000000)).padStart(OTP_LENGTH, '0')

const hashOtp = (otp) => (
  crypto
    .createHmac('sha256', getOtpSecret())
    .update(String(otp))
    .digest('hex')
)

const createOtpChallenge = (otp, minutes = OTP_EXPIRY_MINUTES) => ({
  codeHash: hashOtp(otp),
  expiresAt: new Date(Date.now() + minutes * 60 * 1000),
  lastSentAt: new Date(),
  attempts: 0
})

const isInCooldown = (challenge, seconds = 60) => {
  if (!challenge?.lastSentAt) {
    return false
  }

  return Date.now() - new Date(challenge.lastSentAt).getTime() < seconds * 1000
}

const verifyOtpChallenge = (challenge, otp) => {
  if (!challenge?.codeHash || !challenge?.expiresAt) {
    return { valid: false, message: 'Verification code is missing or expired.' }
  }

  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return { valid: false, message: 'Verification code has expired.' }
  }

  if ((challenge.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return { valid: false, message: 'Too many incorrect codes. Please request a new code.' }
  }

  challenge.attempts = (challenge.attempts || 0) + 1

  if (hashOtp(otp) !== challenge.codeHash) {
    return { valid: false, message: 'Verification code is incorrect.' }
  }

  return { valid: true }
}

const generateRecoveryCodes = (count = 8) => Array.from({ length: count }, () => {
  const value = crypto.randomBytes(6).toString('hex').toUpperCase()
  return `${value.slice(0, 6)}-${value.slice(6)}`
})

const hashRecoveryCode = (code) => hashOtp(String(code).replace(/\s/g, '').toUpperCase())

const consumeRecoveryCode = (hashes = [], code) => {
  const target = hashRecoveryCode(code)
  const index = hashes.findIndex((value) => value === target)
  if (index === -1) return { valid: false, hashes }
  return { valid: true, hashes: hashes.filter((_, itemIndex) => itemIndex !== index) }
}

module.exports = {
  generateOtp,
  createOtpChallenge,
  isInCooldown,
  verifyOtpChallenge,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode
}
