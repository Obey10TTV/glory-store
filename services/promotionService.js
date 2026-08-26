const Promotion = require('../models/promotion')

const readPromotionCapacity = (marketCode = 'GB', placement = 'homepage_featured') => {
  const placementKey = placement === 'homepage_hero'
    ? 'HERO'
    : (placement === 'homepage_video' ? 'VIDEO' : 'SPOTLIGHT')
  const configured = Number.parseInt(
    process.env[`${marketCode}_${placementKey}_CAPACITY`]
      || process.env[`HOMEPAGE_${placementKey}_CAPACITY`],
    10
  )
  const defaultCapacity = ['homepage_video', 'homepage_hero'].includes(placement) ? 1 : 4
  const requestedCapacity = Number.isInteger(configured) && configured >= 1 && configured <= 32
    ? configured
    : defaultCapacity

  // Homepage video is a premium takeover, rather than a crowded sequence of ads.
  // Spotlights stay intentionally limited so each paid placement remains visible.
  return ['homepage_video', 'homepage_hero'].includes(placement)
    ? 1
    : Math.min(requestedCapacity, 4)
}

const DAY_MS = 24 * 60 * 60 * 1000
const SCHEDULE_LOOKAHEAD_DAYS = 90

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

const toUtcDayStart = (dateOnly) => {
  if (!isDateOnly(dateOnly)) return null
  const [year, month, day] = String(dateOnly).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    ? null
    : date
}

const toDateOnly = (date) => new Date(date).toISOString().slice(0, 10)

const createCampaignWindow = ({ startDate, durationDays, now = new Date() }) => {
  const startsAt = toUtcDayStart(startDate)
  const earliestStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const days = Number(durationDays)
  if (!startsAt || !Number.isInteger(days) || days < 1 || days > 31 || startsAt < earliestStart) return null

  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + (days * DAY_MS))
  }
}

const hasWindowOverlap = (promotion, window) => {
  const startsAt = new Date(promotion.startsAt).getTime()
  const endsAt = new Date(promotion.endsAt).getTime()
  return Number.isFinite(startsAt)
    && Number.isFinite(endsAt)
    && startsAt < window.endsAt.getTime()
    && endsAt > window.startsAt.getTime()
}

const findAvailableSlot = (promotions, capacity, window) => {
  for (let slotNumber = 1; slotNumber <= capacity; slotNumber += 1) {
    const conflict = promotions.some((promotion) => (
      Number(promotion.slotNumber) === slotNumber && hasWindowOverlap(promotion, window)
    ))
    if (!conflict) return slotNumber
  }
  return null
}

const getOccupiedPromotions = async ({ marketCode, placement, from, until }) => Promotion.find({
  marketCode,
  placement,
  status: { $in: ['pending_payment', 'scheduled', 'active'] },
  startsAt: { $lt: until },
  endsAt: { $gt: from }
}).select('slotNumber startsAt endsAt').lean()

const getAvailablePromotionStartDates = async ({ marketCode, placement, durationDays, now = new Date() }) => {
  const earliest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const latest = new Date(earliest.getTime() + ((SCHEDULE_LOOKAHEAD_DAYS + Number(durationDays)) * DAY_MS))
  const occupied = await getOccupiedPromotions({ marketCode, placement, from: earliest, until: latest })
  const capacity = readPromotionCapacity(marketCode, placement)
  const dates = []

  for (let offset = 0; offset < SCHEDULE_LOOKAHEAD_DAYS && dates.length < 21; offset += 1) {
    const startDate = toDateOnly(new Date(earliest.getTime() + (offset * DAY_MS)))
    const window = createCampaignWindow({ startDate, durationDays, now })
    if (window && findAvailableSlot(occupied, capacity, window)) dates.push(startDate)
  }
  return dates
}

const releaseExpiredPromotionSlots = async (now = new Date()) => {
  const pendingExpiry = new Date(now.getTime() - 35 * 60 * 1000)
  await Promise.all([
    Promotion.updateMany(
      { status: { $in: ['active', 'scheduled'] }, endsAt: { $lte: now } },
      { $set: { status: 'expired' }, $unset: { slotNumber: 1 } }
    ),
    Promotion.updateMany(
      { status: 'pending_payment', createdAt: { $lte: pendingExpiry }, creativeReviewStatus: 'approved' },
      {
        $set: { status: 'approved_for_payment', failureReason: 'The payment reservation expired. Choose another available date to continue.' },
        $unset: { slotNumber: 1 }
      }
    ),
    Promotion.updateMany(
      { status: 'pending_payment', createdAt: { $lte: pendingExpiry }, creativeReviewStatus: { $ne: 'approved' } },
      {
        $set: { status: 'failed', failureReason: 'The promotion payment reservation expired.' },
        $unset: { slotNumber: 1 }
      }
    )
  ])
}

const activateScheduledPromotions = async (now = new Date()) => {
  const due = await Promotion.find({
    status: 'scheduled',
    startsAt: { $lte: now },
    endsAt: { $gt: now }
  }).select('_id listing seller')

  for (const promotion of due) {
    const updated = await Promotion.findOneAndUpdate(
      { _id: promotion._id, status: 'scheduled', startsAt: { $lte: now }, endsAt: { $gt: now } },
      { $set: { status: 'active' } },
      { new: true }
    )
    if (updated) continue
  }
}

const runPromotionMaintenance = async (now = new Date()) => {
  await releaseExpiredPromotionSlots(now)
  await activateScheduledPromotions(now)
}

const reserveCampaignSlot = async ({ promotionData, existingPromotionId, startDate }) => {
  const now = new Date()
  await runPromotionMaintenance(now)
  const marketCode = promotionData.marketCode || 'GB'
  const placement = promotionData.placement || 'homepage_featured'
  const capacity = readPromotionCapacity(marketCode, placement)
  const window = createCampaignWindow({ startDate, durationDays: promotionData.durationDays, now })
  if (!window) return null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const occupied = await getOccupiedPromotions({
      marketCode,
      placement,
      from: window.startsAt,
      until: window.endsAt
    })
    const slotNumber = findAvailableSlot(occupied, capacity, window)
    if (!slotNumber) return null

    try {
      if (existingPromotionId) {
        const reserved = await Promotion.findOneAndUpdate(
          { _id: existingPromotionId, status: 'approved_for_payment', slotNumber: { $exists: false } },
          { $set: { slotNumber, status: 'pending_payment', ...window, failureReason: '' } },
          { new: true, runValidators: true }
        )
        if (reserved) return reserved
        return null
      }
      return await Promotion.create({ ...promotionData, ...window, slotNumber, status: 'pending_payment' })
    } catch (error) {
      if (error?.code !== 11000) throw error
    }
  }
  return null
}

const reserveHomepagePromotion = async (promotionData, schedule) => reserveCampaignSlot({
  promotionData,
  startDate: schedule?.startDate
})

const reserveApprovedPromotion = async (promotionId, schedule) => {
  await runPromotionMaintenance()
  const promotion = await Promotion.findOne({
    _id: promotionId,
    status: 'approved_for_payment',
    creativeReviewStatus: 'approved'
  })
  if (!promotion) return null
  return reserveCampaignSlot({ promotionData: promotion.toObject(), existingPromotionId: promotion._id, startDate: schedule?.startDate })
}

const ensurePromotionSchedulingIndexes = async () => {
  const indexes = await Promotion.collection.indexes()
  const legacyIndex = indexes.find((index) => (
    index.unique
    && index.key?.marketCode === 1
    && index.key?.placement === 1
    && index.key?.slotNumber === 1
    && !Object.prototype.hasOwnProperty.call(index.key, 'startsAt')
  ))
  if (legacyIndex) await Promotion.collection.dropIndex(legacyIndex.name)
  await Promotion.collection.createIndex(
    { marketCode: 1, placement: 1, slotNumber: 1, startsAt: 1 },
    { unique: true, sparse: true, name: 'promotion_slot_start_unique' }
  )
}

module.exports = {
  readPromotionCapacity,
  createCampaignWindow,
  getAvailablePromotionStartDates,
  activateScheduledPromotions,
  runPromotionMaintenance,
  ensurePromotionSchedulingIndexes,
  releaseExpiredPromotionSlots,
  reserveApprovedPromotion,
  reserveHomepagePromotion
}
