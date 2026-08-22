const { SuiGrpcClient } = require('@mysten/sui/grpc')
const { isValidTransactionDigest, normalizeSuiAddress } = require('@mysten/sui/utils')
const { getSuiConfig, TESTNET_NETWORK } = require('../utils/suiConfig')

const createSuiClient = (config = getSuiConfig()) => {
  if (!config.rpcUrl) {
    throw Object.assign(new Error('Sui testnet verification is not configured'), { statusCode: 503 })
  }

  return new SuiGrpcClient({
    network: TESTNET_NETWORK,
    baseUrl: config.rpcUrl
  })
}

const readVerifiedSuiTransaction = async (digest, { client, env = process.env } = {}) => {
  const normalizedDigest = String(digest || '').trim()
  if (!isValidTransactionDigest(normalizedDigest)) {
    throw Object.assign(new Error('A valid Sui transaction digest is required'), { statusCode: 400 })
  }

  const config = getSuiConfig(env)
  if (config.network !== TESTNET_NETWORK || !config.rpcUrl) {
    throw Object.assign(new Error('Sui testnet verification is not configured'), { statusCode: 503 })
  }

  const result = await (client || createSuiClient(config)).getTransaction({
    digest: normalizedDigest,
    include: {
      effects: true,
      events: true,
      objectTypes: true,
      transaction: true
    }
  })
  const transaction = result?.Transaction || result?.FailedTransaction

  if (!transaction?.status?.success || transaction.digest !== normalizedDigest) {
    throw Object.assign(new Error('The submitted Sui transaction was not successful'), { statusCode: 422 })
  }

  return { config, transaction }
}

const findGloryVerificationEvent = (transaction, config) => {
  if (!config.packageId) {
    throw Object.assign(new Error('Sui product verification package is not configured'), { statusCode: 503 })
  }

  const packageId = normalizeSuiAddress(config.packageId)
  const expectedEventType = config.verificationEventType.toLowerCase()
  return (transaction.events || []).find((event) => (
    normalizeSuiAddress(String(event.packageId)) === packageId
      && String(event.eventType).toLowerCase() === expectedEventType
  )) || null
}

module.exports = {
  createSuiClient,
  readVerifiedSuiTransaction,
  findGloryVerificationEvent
}
