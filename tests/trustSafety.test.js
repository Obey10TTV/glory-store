const test = require('node:test')
const assert = require('node:assert/strict')
const { getReportSlaState, scheduleReportReview } = require('../services/trustSafetyService')

test('critical product-safety reports receive one-hour triage and 24-hour resolution targets', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')
  const schedule = scheduleReportReview('unsafe_product', now)
  assert.equal(schedule.priority, 'critical')
  assert.equal(schedule.triageDueAt.toISOString(), '2026-08-13T13:00:00.000Z')
  assert.equal(schedule.resolutionDueAt.toISOString(), '2026-08-14T12:00:00.000Z')
})

test('report SLA state distinguishes triage and resolution breaches', () => {
  const now = new Date('2026-08-14T13:00:00.000Z')
  assert.equal(getReportSlaState({
    status: 'received',
    triageDueAt: new Date('2026-08-13T13:00:00.000Z'),
    resolutionDueAt: new Date('2026-08-15T12:00:00.000Z')
  }, now), 'triage_breached')
  assert.equal(getReportSlaState({
    status: 'in_review',
    firstReviewedAt: new Date('2026-08-13T12:30:00.000Z'),
    resolutionDueAt: new Date('2026-08-14T12:00:00.000Z')
  }, now), 'resolution_breached')
  assert.equal(getReportSlaState({ status: 'actioned' }, now), 'closed')
})
