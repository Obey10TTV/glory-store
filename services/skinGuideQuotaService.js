const SkinGuideUsage = require('../models/skinGuideUsage')

const readPositiveInteger = (name, fallback, maximum) => {
  const parsed = Number.parseInt(process.env[name], 10)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

const getSkinGuideLimits = () => ({
  dailyMessages: readPositiveInteger('SKIN_GUIDE_DAILY_MESSAGE_LIMIT', 10, 100),
  dailyImages: readPositiveInteger('SKIN_GUIDE_DAILY_IMAGE_LIMIT', 3, 20),
  dailyHandoffs: readPositiveInteger('SKIN_GUIDE_DAILY_HANDOFF_LIMIT', 3, 20),
  globalDailyRequests: readPositiveInteger('SKIN_GUIDE_GLOBAL_DAILY_REQUEST_LIMIT', 250, 100000)
})

const getDayKey = (date = new Date()) => date.toISOString().slice(0, 10)

const getFieldForKind = (kind) => ({
  message: 'messageCount',
  image: 'imageCount',
  handoff: 'handoffCount'
}[kind])

const incrementWithinLimit = async ({ dayKey, scopeKey, field, limit }) => {
  const filter = { dayKey, scopeKey, [field]: { $lt: limit } }
  const update = { $setOnInsert: { dayKey, scopeKey }, $inc: { [field]: 1 } }

  try {
    return await SkinGuideUsage.findOneAndUpdate(filter, update, { new: true, upsert: true })
  } catch (error) {
    // A simultaneous first request can race the unique index. Retry without an
    // upsert so a duplicate-key error is treated as a normal quota result.
    if (error?.code !== 11000) throw error
    return SkinGuideUsage.findOneAndUpdate(filter, update, { new: true })
  }
}

const decrement = (dayKey, scopeKey, field) => SkinGuideUsage.updateOne(
  { dayKey, scopeKey, [field]: { $gt: 0 } },
  { $inc: { [field]: -1 } }
).catch(() => undefined)

const consumeSkinGuideQuota = async ({ userId, kind = 'message' }) => {
  const field = getFieldForKind(kind)
  if (!field) throw new Error('Unsupported Skin Guide quota type')

  const limits = getSkinGuideLimits()
  const dayKey = getDayKey()
  const userLimit = kind === 'message'
    ? limits.dailyMessages
    : kind === 'image'
      ? limits.dailyImages
      : limits.dailyHandoffs
  const userScope = `user:${userId}`

  const userUsage = await incrementWithinLimit({ dayKey, scopeKey: userScope, field, limit: userLimit })
  if (!userUsage) {
    return { allowed: false, reason: 'account_limit', limits }
  }

  const globalUsage = await incrementWithinLimit({
    dayKey,
    scopeKey: 'global',
    field: 'requestCount',
    limit: limits.globalDailyRequests
  })
  if (!globalUsage) {
    await decrement(dayKey, userScope, field)
    return { allowed: false, reason: 'global_limit', limits }
  }

  return {
    allowed: true,
    limits,
    remaining: Math.max(0, userLimit - userUsage[field])
  }
}

const getSkinGuideUsage = async (userId) => {
  const [usage] = await SkinGuideUsage.find({ dayKey: getDayKey(), scopeKey: `user:${userId}` })
  const limits = getSkinGuideLimits()
  return {
    limits,
    messagesUsed: usage?.messageCount || 0,
    imagesUsed: usage?.imageCount || 0,
    handoffsUsed: usage?.handoffCount || 0
  }
}

module.exports = { consumeSkinGuideQuota, getSkinGuideUsage, getSkinGuideLimits }
