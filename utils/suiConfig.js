const TESTNET_NETWORK = 'testnet'
const FORBIDDEN_CUSTODIAL_ENV_KEYS = [
  'SUI_PRIVATE_KEY',
  'SUI_MNEMONIC',
  'SUI_SEED_PHRASE',
  'SUI_KEYSTORE_PATH'
]

const normalize = (value = '') => String(value || '').trim()

const isHttpsUrl = (value) => {
  if (!value) return true
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const getSuiConfig = (env = process.env) => {
  const network = normalize(env.SUI_NETWORK || TESTNET_NETWORK).toLowerCase()
  const rpcUrl = normalize(env.SUI_RPC_URL)
  const packageId = normalize(env.SUI_PACKAGE_ID)
  const registryObjectId = normalize(env.SUI_VERIFICATION_REGISTRY_ID)
  const explorerBaseUrl = normalize(env.SUI_EXPLORER_BASE_URL || 'https://suiscan.xyz/testnet')
  const verificationEventType = normalize(env.SUI_VERIFICATION_EVENT_TYPE)
    || (packageId ? `${packageId}::glory_verification::ProductVerified` : '')
  const verificationObjectType = packageId
    ? `${packageId}::glory_verification::ProductVerification`
    : ''

  return {
    enabled: network === TESTNET_NETWORK && Boolean(rpcUrl && packageId && registryObjectId),
    network,
    rpcUrl,
    packageId,
    registryObjectId,
    explorerBaseUrl,
    verificationEventType,
    verificationObjectType
  }
}

const assertSuiConfiguration = (env = process.env) => {
  const config = getSuiConfig(env)
  const failures = []

  if (config.network !== TESTNET_NETWORK) {
    failures.push('SUI_NETWORK must be testnet while Sui is in Glory testing')
  }
  if (!isHttpsUrl(config.rpcUrl)) failures.push('SUI_RPC_URL must use HTTPS')
  if (!isHttpsUrl(config.explorerBaseUrl)) failures.push('SUI_EXPLORER_BASE_URL must use HTTPS')
  FORBIDDEN_CUSTODIAL_ENV_KEYS.forEach((key) => {
    if (normalize(env[key])) failures.push(`${key} must not be configured; Glory never stores Sui signing material`)
  })

  if (failures.length) throw new Error(`Sui configuration invalid: ${failures.join('; ')}`)
  return config
}

module.exports = { TESTNET_NETWORK, getSuiConfig, assertSuiConfiguration }
