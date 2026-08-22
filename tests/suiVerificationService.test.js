const test = require('node:test')
const assert = require('node:assert/strict')

const {
  readVerifiedSuiTransaction,
  findGloryVerificationEvent,
  findGloryVerificationObject
} = require('../services/suiVerificationService')

const digest = '2'.repeat(44)
const testnetEnv = { SUI_NETWORK: 'testnet', SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443' }

test('Sui transaction verification accepts only a server-read successful digest', async () => {
  const client = {
    getTransaction: async () => ({
      Transaction: {
        digest,
        status: { success: true },
        events: [],
        effects: {},
        transaction: { sender: '0xabc' }
      }
    })
  }

  const result = await readVerifiedSuiTransaction(digest, { client, env: testnetEnv })
  assert.equal(result.transaction.digest, digest)
})

test('Sui transaction verification rejects client-provided failed or malformed transactions', async () => {
  await assert.rejects(
    () => readVerifiedSuiTransaction('not-a-sui-digest', { env: testnetEnv }),
    /valid Sui transaction digest/
  )

  await assert.rejects(
    () => readVerifiedSuiTransaction(digest, {
      env: testnetEnv,
      client: { getTransaction: async () => ({ FailedTransaction: { digest, status: { success: false } } }) }
    }),
    /not successful/
  )
})

test('Sui product proofs require Glory\'s exact configured verification event', () => {
  const config = {
    packageId: '0x1',
    verificationEventType: '0x1::glory_verification::ProductVerified',
    verificationObjectType: '0x1::glory_verification::ProductVerification'
  }
  const event = { packageId: '0x0001', eventType: '0x1::glory_verification::ProductVerified' }
  assert.equal(findGloryVerificationEvent({ events: [event] }, config), event)
  assert.equal(findGloryVerificationEvent({ events: [{ packageId: '0x1', eventType: '0x1::other::ProductVerified' }] }, config), null)
  assert.equal(findGloryVerificationObject({
    effects: { changedObjects: [{ objectId: '0xabc', idOperation: 'Created', outputState: 'ObjectWrite' }] },
    objectTypes: { '0xabc': '0x1::glory_verification::ProductVerification' }
  }, config), '0xabc')
})
