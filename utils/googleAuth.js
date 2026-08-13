const { OAuth2Client } = require('google-auth-library')

let googleClient

const authError = (message, statusCode = 401) => {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

const cleanName = (value, email) => {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

  return normalized || String(email).split('@')[0].slice(0, 80) || 'Glory member'
}

const safeGoogleAvatar = (value) => {
  try {
    const url = new URL(String(value || ''))
    const trustedHost = url.hostname === 'googleusercontent.com'
      || url.hostname.endsWith('.googleusercontent.com')

    return url.protocol === 'https:' && trustedHost ? url.toString() : ''
  } catch {
    return ''
  }
}

const normalizeGooglePayload = (payload = {}) => {
  const subject = String(payload.sub || '').trim()
  const email = String(payload.email || '').trim().toLowerCase()

  if (!subject || !email || payload.email_verified !== true) {
    throw authError('Google could not verify this account email.')
  }

  return {
    subject,
    email,
    name: cleanName(payload.name, email),
    avatar: safeGoogleAvatar(payload.picture)
  }
}

const verifyGoogleCredential = async (credential) => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
  if (!clientId) {
    throw authError('Google sign-in is not configured yet.', 503)
  }

  const idToken = String(credential || '').trim()
  if (idToken.length < 100 || idToken.length > 8192) {
    throw authError('Google sign-in could not be verified.')
  }

  googleClient = googleClient || new OAuth2Client()

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: clientId
    })

    return normalizeGooglePayload(ticket.getPayload())
  } catch (error) {
    if (error.statusCode) {
      throw error
    }

    throw authError('Google sign-in could not be verified.')
  }
}

module.exports = {
  getGoogleAuthOptions: () => {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
    return {
      enabled: Boolean(clientId),
      clientId: clientId || null
    }
  },
  normalizeGooglePayload,
  verifyGoogleCredential
}
