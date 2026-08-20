const winston = require('winston')
const morgan = require('morgan')
const crypto = require('crypto')

const hashIp = (ip = '') => crypto
  .createHmac('sha256', process.env.LOG_HASH_SECRET || process.env.JWT_SECRET || 'glory-local-log-hash')
  .update(String(ip))
  .digest('hex')
  .slice(0, 20)

const sanitizeErrorMessage = (value = '') => String(value)
  .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[redacted-database-url]')
  .replace(/(sk|pk|rk|whsec)_[A-Za-z0-9_]+/g, '[redacted-secret]')
  .slice(0, 500)

// ── WINSTON LOGGER ──
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Error log file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    // Combined log file
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
})

// ── MORGAN HTTP LOGGER ──
const httpLogger = morgan((tokens, req, res) => JSON.stringify({
  type: 'HTTP_REQUEST',
  method: tokens.method(req, res),
  path: req.path,
  status: Number(tokens.status(req, res)),
  durationMs: Number(tokens['response-time'](req, res)),
  contentLength: tokens.res(req, res, 'content-length') || undefined,
  requestId: req.requestId,
  ipHash: hashIp(req.ip),
  userAgent: String(req.get('user-agent') || '').slice(0, 240)
}), {
  stream: {
    write: (message) => logger.info(message.trim())
  },
  skip: (req) => ['/api/health', '/api/ready'].includes(req.url)
})

// ── SECURITY EVENT LOGGER ──
const logSecurityEvent = (event, details, req) => {
  logger.warn({
    type: 'SECURITY_EVENT',
    event,
    details,
    ipHash: hashIp(req?.ip),
    path: req?.path,
    method: req?.method,
    userAgent: req?.headers['user-agent'],
    timestamp: new Date().toISOString()
  })
}

// ── AUTH EVENT LOGGER ──
const logAuthEvent = (event, userId, req) => {
  logger.info({
    type: 'AUTH_EVENT',
    event,
    userId,
    ipHash: hashIp(req?.ip),
    timestamp: new Date().toISOString()
  })
}

module.exports = { logger, httpLogger, logSecurityEvent, logAuthEvent, sanitizeErrorMessage }
