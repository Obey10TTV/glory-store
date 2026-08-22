const test = require('node:test')
const assert = require('node:assert/strict')
const SkinGuideUsage = require('../models/skinGuideUsage')
const { getSkinGuideLimits } = require('../services/skinGuideQuotaService')

const withEnv = (values, run) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
  try {
    run()
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
  }
}

test('Skin Guide defaults to small, bounded daily allowances', () => {
  withEnv({
    SKIN_GUIDE_DAILY_MESSAGE_LIMIT: undefined,
    SKIN_GUIDE_DAILY_IMAGE_LIMIT: undefined,
    SKIN_GUIDE_DAILY_HANDOFF_LIMIT: undefined,
    SKIN_GUIDE_GLOBAL_DAILY_REQUEST_LIMIT: undefined
  }, () => {
    assert.deepEqual(getSkinGuideLimits(), {
      dailyMessages: 10,
      dailyImages: 3,
      dailyHandoffs: 3,
      globalDailyRequests: 250
    })
  })
})

test('Skin Guide limits cannot be configured above a safe ceiling', () => {
  withEnv({
    SKIN_GUIDE_DAILY_MESSAGE_LIMIT: '9999',
    SKIN_GUIDE_DAILY_IMAGE_LIMIT: '9999',
    SKIN_GUIDE_DAILY_HANDOFF_LIMIT: '9999',
    SKIN_GUIDE_GLOBAL_DAILY_REQUEST_LIMIT: '999999'
  }, () => {
    assert.deepEqual(getSkinGuideLimits(), {
      dailyMessages: 100,
      dailyImages: 20,
      dailyHandoffs: 20,
      globalDailyRequests: 100000
    })
  })
})

test('Skin Guide quota records expire and preserve no message content', () => {
  const fields = Object.keys(SkinGuideUsage.schema.paths)
  assert.equal(fields.includes('message'), false)
  assert.equal(fields.includes('image'), false)
  assert.equal(SkinGuideUsage.schema.indexes().some(([, options]) => options.expireAfterSeconds === 60 * 60 * 24 * 45), true)
})
