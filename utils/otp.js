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

const matchesHash = (left, right) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

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

  if (!matchesHash(hashOtp(otp), challenge.codeHash)) {
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
  const index = hashes.findIndex((value) => matchesHash(value, target))
  if (index === -1) return { valid: false, hashes }
  return { valid: true, hashes: hashes.filter((_, itemIndex) => itemIndex !== index) }
}

// Keep verification and consumption conditional on the exact challenge read.
// Concurrent requests, resends and expired challenges cannot reuse that state.
const updateLoginChallenge = (User, { userId, path, challenge, valid, conditions, set = {}, pull }) => {
  if (!challenge?.codeHash || !challenge.lastSentAt) return null

  return User.findOneAndUpdate({
    ...conditions,
    _id: userId,
    [`${path}.codeHash`]: challenge.codeHash,
    [`${path}.lastSentAt`]: challenge.lastSentAt,
    [`${path}.expiresAt`]: { $gt: new Date() },
    [`${path}.attempts`]: { $lt: OTP_MAX_ATTEMPTS }
  }, valid
    ? {
        $set: { ...set, [path]: {} },
        ...(pull ? { $pull: pull } : {})
      }
    : { $inc: { [`${path}.attempts`]: 1 } },
  { new: true })
}

module.exports = {
  generateOtp,
  createOtpChallenge,
  isInCooldown,
  verifyOtpChallenge,
  updateLoginChallenge,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode
}
