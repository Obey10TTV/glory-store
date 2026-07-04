const nodemailer = require('nodemailer')
const { logger } = require('../middleware/logger')

let transporter

const getTransporter = () => {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS
  } = process.env

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === 'true',
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  }

  return transporter
}

const purposeLabels = {
  'verify-email': 'Verify your Glory account',
  'login-2fa': 'Your Glory sign-in code',
  'enable-2fa': 'Confirm two-factor authentication',
  'disable-2fa': 'Confirm two-factor authentication changes'
}

const sendOtpEmail = async ({ to, code, purpose = 'verify-email' }) => {
  const mailer = getTransporter()
  const subject = purposeLabels[purpose] || 'Your Glory verification code'
  const from = process.env.SMTP_FROM || process.env.SMTP_USER

  if (!mailer) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email service is not configured')
    }

    logger.warn({
      type: 'DEV_OTP',
      purpose,
      to,
      code,
      message: 'SMTP is not configured. This code is logged for local development only.'
    })
    return
  }

  await mailer.sendMail({
    from,
    to,
    subject,
    text: `Your Glory verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.6;">
        <h2 style="margin: 0 0 12px;">${subject}</h2>
        <p>Your Glory verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${code}</p>
        <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
      </div>
    `
  })
}

module.exports = { sendOtpEmail }
