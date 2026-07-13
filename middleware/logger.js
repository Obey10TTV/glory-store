const winston = require('winston')
const morgan = require('morgan')

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
const httpLogger = morgan('combined', {
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
    ip: req?.ip,
    url: req?.url,
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
    ip: req?.ip,
    timestamp: new Date().toISOString()
  })
}

module.exports = { logger, httpLogger, logSecurityEvent, logAuthEvent }
