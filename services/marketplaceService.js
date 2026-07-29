const KNOWN_PAYMENT_METHODS = ['card', 'bank_transfer', 'crypto']

const readInteger = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

const getMarketplaceConfig = () => {
  const cardEnabled = Boolean(process.env.STRIPE_SECRET_KEY)

  return {
    currency: 'GBP',
    sellerActivationRequired: process.env.SELLER_ACTIVATION_REQUIRED !== 'false',
    sellerActivationFeePence: readInteger(
      process.env.SELLER_ACTIVATION_FEE_PENCE,
      2000,
      { min: 0, max: 100000 }
    ),
    platformCommissionBps: readInteger(
      process.env.PLATFORM_COMMISSION_BPS,
      1000,
      { min: 0, max: 5000 }
    ),
    paymentMethods: [
      {
        code: 'card',
        orderValue: 'Stripe',
        label: 'Credit or debit card',
        description: 'Visa, Mastercard and other supported cards through Stripe.',
        enabled: cardEnabled
      },
      {
        code: 'bank_transfer',
        orderValue: null,
        label: 'Bank payment',
        description: 'Unavailable until provider reconciliation and refund handling are configured.',
        enabled: false
      },
      {
        code: 'crypto',
        orderValue: null,
        label: 'Crypto payment',
        description: 'Unavailable until a compliant payment provider and refund process are configured.',
        enabled: false
      }
    ]
  }
}

const normalizePaymentMethods = (methods, fallback = ['card']) => {
  if (!Array.isArray(methods)) return [...fallback]
  const unique = [...new Set(methods.map(method => String(method).trim().toLowerCase()))]
  const supported = unique.filter(method => KNOWN_PAYMENT_METHODS.includes(method))
  return supported.length ? supported : [...fallback]
}

const orderValueToMethodCode = (value) => {
  const config = getMarketplaceConfig()
  return config.paymentMethods.find(method => method.orderValue === value)?.code || null
}

module.exports = {
  KNOWN_PAYMENT_METHODS,
  getMarketplaceConfig,
  normalizePaymentMethods,
  orderValueToMethodCode
}
