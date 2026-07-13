const AuditLog = require('../models/auditLog')
const { logger } = require('../middleware/logger')

const recordAudit = async (req, entry) => {
  try {
    await AuditLog.create({
      actor: req.user._id,
      requestId: req.requestId || '',
      ...entry
    })
  } catch (error) {
    logger.error({ type: 'AUDIT_WRITE_FAILED', message: error.message, action: entry.action })
  }
}

module.exports = { recordAudit }
