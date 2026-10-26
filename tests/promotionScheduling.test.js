const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createCampaignWindow,
  readPromotionCapacity
} = require('../services/promotionService')

test('campaign windows start on the selected future day and preserve full duration', () => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  const window = createCampaignWindow({
    startDate: '2026-08-28',
    durationDays: 7,
    now
  })

  assert.equal(window.startsAt.toISOString(), '2026-08-28T00:00:00.000Z')
  assert.equal(window.endsAt.toISOString(), '2026-09-04T00:00:00.000Z')
})

test('campaign scheduling rejects past, malformed, and overlong bookings', () => {
  const now = new Date('2026-08-26T12:00:00.000Z')
  assert.equal(createCampaignWindow({ startDate: '2026-08-26', durationDays: 7, now }), null)
  assert.equal(createCampaignWindow({ startDate: '26-08-2026', durationDays: 7, now }), null)
  assert.equal(createCampaignWindow({ startDate: '2026-08-28', durationDays: 32, now }), null)
})

test('homepage inventory is deliberately finite by placement type', () => {
  assert.equal(readPromotionCapacity('GB', 'homepage_featured'), 4)
  assert.equal(readPromotionCapacity('GB', 'homepage_video'), 1)
})
