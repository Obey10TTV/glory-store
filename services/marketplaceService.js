const KNOWN_PAYMENT_METHODS = ['card', 'bank_transfer', 'crypto']

const readInteger = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

const getMarketplaceConfig = () => {
  const cardEnabled = Boolean(process.env.STRIPE_SECRET_KEY)
  const directCheckoutEnabled = process.env.GLORY_DIRECT_CHECKOUT === 'true'

  return {
    marketplaceMode: directCheckoutEnabled ? 'checkout' : 'classified',
    directCheckoutEnabled,
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

const getPromotionPlans = () => {
  const marketplace = getMarketplaceConfig()
  const durationDays = readInteger(
    process.env.HOMEPAGE_FEATURED_DURATION_DAYS,
    7,
    { min: 1, max: 31 }
  )

  return [{
    code: 'homepage_featured',
    placement: 'homepage_featured',
    label: 'Homepage featured placement',
    description: `One approved listing in Glory's clearly labelled Sponsored home-page edit for ${durationDays} days.`,
    feePence: readInteger(
      process.env.HOMEPAGE_FEATURED_FEE_PENCE,
      999,
      { min: 100, max: 100000 }
    ),
    currency: marketplace.currency,
    durationDays
  }]
}

const getPromotionPlan = (code) => (
  getPromotionPlans().find((plan) => plan.code === String(code || '').trim()) || null
)

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
  getPromotionPlans,
  getPromotionPlan,
  normalizePaymentMethods,
  orderValueToMethodCode
}
