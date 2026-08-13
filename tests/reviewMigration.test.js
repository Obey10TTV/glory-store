const test = require('node:test')
const assert = require('node:assert/strict')
const { REVIEW_INTEGRITY_MIGRATION } = require('../services/reviewMigrationService')

test('legacy review migration uses a stable one-time identifier', () => {
  assert.equal(REVIEW_INTEGRITY_MIGRATION, 'verified-interaction-reviews-v1')
})
