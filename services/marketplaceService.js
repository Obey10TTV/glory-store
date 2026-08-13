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
    sellerActivationRequired: process.env.SELLER_ACTIVATION_REQUIRED === 'true',
    sellerActivationFeePence: readInteger(
      process.env.SELLER_ACTIVATION_FEE_PENCE,
      4900,
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

const getSellerPlans = () => ([
  {
    code: 'starter',
    label: 'Starter',
    description: 'A verified entry tier for independent sellers building their first Glory catalogue.',
    feePence: 0,
    currency: 'GBP',
    interval: null,
    activeListingLimit: 5,
    promotionDiscountBps: 0,
    reviewPriority: 'standard',
    features: ['Up to 5 active listings', 'Buyer enquiries and verified-interaction reviews', 'Standard listing review']
  },
  {
    code: 'studio',
    label: 'Studio',
    description: 'For growing beauty businesses that need meaningful catalogue capacity and lower campaign costs.',
    feePence: readInteger(process.env.SELLER_STUDIO_MONTHLY_FEE_PENCE, 5900, { min: 1000, max: 1000000 }),
    currency: 'GBP',
    interval: 'month',
    activeListingLimit: 50,
    promotionDiscountBps: 1000,
    reviewPriority: 'priority',
    stripePriceId: String(process.env.STRIPE_SELLER_STUDIO_PRICE_ID || '').trim(),
    features: ['Up to 50 active listings', '10% off paid visibility', 'Priority listing review queue']
  },
  {
    code: 'scale',
    label: 'Scale',
    description: 'For established sellers running a broad catalogue and regular acquisition campaigns.',
    feePence: readInteger(process.env.SELLER_SCALE_MONTHLY_FEE_PENCE, 14900, { min: 2500, max: 2000000 }),
    currency: 'GBP',
    interval: 'month',
    activeListingLimit: 200,
    promotionDiscountBps: 2000,
    reviewPriority: 'priority',
    stripePriceId: String(process.env.STRIPE_SELLER_SCALE_PRICE_ID || '').trim(),
    features: ['Up to 200 active listings', '20% off paid visibility', 'Priority listing review queue']
  },
  {
    code: 'partner',
    label: 'Brand Partner',
    description: 'For high-volume brands that need extensive inventory capacity and managed campaign support.',
    feePence: readInteger(process.env.SELLER_PARTNER_MONTHLY_FEE_PENCE, 39900, { min: 5000, max: 5000000 }),
    currency: 'GBP',
    interval: 'month',
    activeListingLimit: 750,
    promotionDiscountBps: 2500,
    reviewPriority: 'priority',
    stripePriceId: String(process.env.STRIPE_SELLER_PARTNER_PRICE_ID || '').trim(),
    features: ['Up to 750 active listings', '25% off paid visibility', 'Managed campaign support']
  }
])

const getSellerPlan = (code) => (
  getSellerPlans().find((plan) => plan.code === String(code || '').trim().toLowerCase()) || null
)

const getPromotionPlans = () => {
  const marketplace = getMarketplaceConfig()

  return [
    {
      code: 'homepage_spotlight_7',
      placement: 'homepage_featured',
      label: 'Homepage Spotlight',
      description: "One approved listing in Glory's clearly labelled Sponsored homepage edit for 7 days.",
      feePence: readInteger(process.env.HOMEPAGE_SPOTLIGHT_7_FEE_PENCE, 8900, { min: 1000, max: 1000000 }),
      currency: marketplace.currency,
      durationDays: 7,
      recommended: true
    },
    {
      code: 'homepage_spotlight_30',
      placement: 'homepage_featured',
      label: 'Homepage Spotlight 30',
      description: "One approved listing in Glory's clearly labelled Sponsored homepage edit for 30 days.",
      feePence: readInteger(process.env.HOMEPAGE_SPOTLIGHT_30_FEE_PENCE, 24900, { min: 2500, max: 2000000 }),
      currency: marketplace.currency,
      durationDays: 30,
      recommended: false
    }
  ]
}

const getPromotionPlan = (code) => (
  getPromotionPlans().find((plan) => plan.code === String(code || '').trim()) || null
)

const getEffectiveSellerPlan = (sellerProfile = {}) => {
  const requested = getSellerPlan(sellerProfile.membershipPlanCode)
  if (!requested || requested.code === 'starter') return getSellerPlan('starter')
  return sellerProfile.membershipStatus === 'active' ? requested : getSellerPlan('starter')
}

const pricePromotionForSeller = (promotionPlan, sellerProfile = {}) => {
  const sellerPlan = getEffectiveSellerPlan(sellerProfile)
  const discountPence = Math.floor(
    Number(promotionPlan.feePence) * Number(sellerPlan.promotionDiscountBps || 0) / 10000
  )
  return {
    baseFeePence: promotionPlan.feePence,
    discountPence,
    feePence: Math.max(100, promotionPlan.feePence - discountPence),
    sellerPlanCode: sellerPlan.code
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
  getEffectiveSellerPlan,
  getMarketplaceConfig,
  getPromotionPlans,
  getPromotionPlan,
  getSellerPlan,
  getSellerPlans,
  normalizePaymentMethods,
  orderValueToMethodCode,
  pricePromotionForSeller
}
