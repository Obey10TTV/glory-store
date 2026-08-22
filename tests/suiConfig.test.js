const test = require('node:test')
const assert = require('node:assert/strict')

const { getSuiConfig, assertSuiConfiguration } = require('../utils/suiConfig')

test('Sui is disabled by default but remains pinned to testnet', () => {
  const config = getSuiConfig({})
  assert.equal(config.network, 'testnet')
  assert.equal(config.enabled, false)
  assert.doesNotThrow(() => assertSuiConfiguration({}))
})

test('Sui configuration rejects mainnet, non-HTTPS RPCs, and signing material', () => {
  assert.throws(() => assertSuiConfiguration({ SUI_NETWORK: 'mainnet' }), /SUI_NETWORK must be testnet/)
  assert.throws(() => assertSuiConfiguration({ SUI_RPC_URL: 'http://example.test' }), /SUI_RPC_URL must use HTTPS/)
  assert.throws(() => assertSuiConfiguration({ SUI_PRIVATE_KEY: 'not-a-real-key' }), /SUI_PRIVATE_KEY must not be configured/)
})
