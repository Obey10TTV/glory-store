const MARKET_CODES = ['NG', 'GB', 'US', 'CA']
const KNOWN_PAYMENT_METHODS = ['card', 'bank_transfer', 'ussd', 'crypto', 'cash_on_delivery']

const MARKET_ALIASES = {
  NG: 'NG',
  NGA: 'NG',
  NIGERIA: 'NG',
  GB: 'GB',
  GBR: 'GB',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
  US: 'US',
  USA: 'US',
  'UNITED STATES': 'US',
  CA: 'CA',
  CAN: 'CA',
  CANADA: 'CA'
}

const readInteger = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

const normalizeMarketCode = (value, fallback = 'NG') => {
  const normalized = MARKET_ALIASES[String(value || '').trim().toUpperCase()]
  return normalized || (MARKET_CODES.includes(fallback) ? fallback : 'NG')
}

const getDefaultMarketCode = () => normalizeMarketCode(process.env.DEFAULT_MARKET_CODE, 'NG')

const marketDefinitions = {
  NG: {
    code: 'NG',
    slug: 'ng',
    name: 'Nigeria',
    locale: 'en-NG',
    currency: 'NGN',
    currencyName: 'Nigerian naira',
    billingProvider: 'paystack',
    starterListingLimit: 10,
    servicePaymentMethods: [
      { code: 'card', label: 'Card', description: 'Visa, Mastercard, Verve and supported international cards through Paystack.' },
      { code: 'bank_transfer', label: 'Bank transfer', description: 'A time-limited Paystack transfer account when available.' },
      { code: 'ussd', label: 'USSD', description: 'Supported Nigerian bank USSD channels through Paystack.' }
    ]
  },
  GB: {
    code: 'GB',
    slug: 'gb',
    name: 'United Kingdom',
    locale: 'en-GB',
    currency: 'GBP',
    currencyName: 'British pounds',
    billingProvider: 'stripe',
    starterListingLimit: 5,
    servicePaymentMethods: [
      { code: 'card', label: 'Card', description: 'Visa, Mastercard and other supported cards through Stripe.' }
    ]
  },
  US: {
    code: 'US',
    slug: 'us',
    name: 'United States',
    locale: 'en-US',
    currency: 'USD',
    currencyName: 'US dollars',
    billingProvider: 'stripe',
    starterListingLimit: 5,
    servicePaymentMethods: [
      { code: 'card', label: 'Card', description: 'Visa, Mastercard, American Express and supported cards through Stripe.' }
    ]
  },
  CA: {
    code: 'CA',
    slug: 'ca',
    name: 'Canada',
    locale: 'en-CA',
    currency: 'CAD',
    currencyName: 'Canadian dollars',
    billingProvider: 'stripe',
    starterListingLimit: 5,
    servicePaymentMethods: [
      { code: 'card', label: 'Card', description: 'Visa, Mastercard, American Express and supported cards through Stripe.' }
    ]
  }
}

const getMarketDefinition = (marketCode) => {
  const code = normalizeMarketCode(marketCode, getDefaultMarketCode())
  return marketDefinitions[code]
}

const isBillingProviderEnabled = (provider) => (
  provider === 'paystack'
    ? Boolean(process.env.PAYSTACK_SECRET_KEY)
    : Boolean(process.env.STRIPE_SECRET_KEY)
)

const getSellerAcceptedPaymentMethods = (marketCode) => {
  const market = getMarketDefinition(marketCode)
  if (market.code === 'NG') {
    return [
      { code: 'card', label: 'Card or payment link', description: 'Use a trusted provider link that supports Visa, Mastercard or Verve.' },
      { code: 'bank_transfer', label: 'Bank transfer', description: 'Agree account details and delivery only inside the Glory conversation.' },
      { code: 'ussd', label: 'USSD', description: 'Available when the seller uses a supported Nigerian payment provider.' },
      { code: 'cash_on_delivery', label: 'Pay on collection or delivery', description: 'Only where the seller clearly offers it and the handover is safe.' },
      { code: 'crypto', label: 'Crypto', description: 'Seller arranged. Confirm the network and amount carefully because transfers may be irreversible.' }
    ]
  }
  return [
    { code: 'card', label: 'Card or payment link', description: 'Use the seller\'s trusted provider link for Visa, Mastercard or another supported card.' },
    { code: 'bank_transfer', label: 'Bank transfer', description: 'Agree account details and delivery only inside the Glory conversation.' },
    { code: 'cash_on_delivery', label: 'Pay on collection or delivery', description: 'Only where the seller clearly offers it and the handover is safe.' },
    { code: 'crypto', label: 'Crypto', description: 'Seller arranged. Confirm the network and amount carefully because transfers may be irreversible.' }
  ]
}

const getMarketplaceConfig = (marketCode) => {
  const market = getMarketDefinition(marketCode)
  const directCheckoutEnabled = process.env.GLORY_DIRECT_CHECKOUT === 'true'
  const activationPrefix = market.code === 'GB' ? '' : `${market.code}_`
  const activationFee = readInteger(
    process.env[`${activationPrefix}SELLER_ACTIVATION_FEE_MINOR`] || process.env.SELLER_ACTIVATION_FEE_PENCE,
    0,
    { min: 0, max: 100000000 }
  )

  return {
    marketCode: market.code,
    slug: market.slug,
    marketName: market.name,
    locale: market.locale,
    marketplaceMode: directCheckoutEnabled ? 'checkout' : 'classified',
    directCheckoutEnabled,
    currency: market.currency,
    currencyName: market.currencyName,
    billingProvider: market.billingProvider,
    billingEnabled: isBillingProviderEnabled(market.billingProvider),
    sellerActivationRequired: process.env[`${activationPrefix}SELLER_ACTIVATION_REQUIRED`] === 'true',
    sellerActivationFeeMinor: activationFee,
    sellerActivationFeePence: activationFee,
    platformCommissionBps: readInteger(
      process.env.PLATFORM_COMMISSION_BPS,
      0,
      { min: 0, max: 5000 }
    ),
    paymentMethods: market.servicePaymentMethods.map((method) => ({
      ...method,
      enabled: isBillingProviderEnabled(market.billingProvider)
    })),
    sellerAcceptedPaymentMethods: getSellerAcceptedPaymentMethods(market.code)
  }
}

const readPlanPrice = (marketCode, planCode, fallback) => {
  const market = getMarketDefinition(marketCode)
  const marketKey = `${market.code}_SELLER_${planCode.toUpperCase()}_MONTHLY_FEE_MINOR`
  const legacyKey = market.code === 'GB' ? `SELLER_${planCode.toUpperCase()}_MONTHLY_FEE_PENCE` : ''
  return readInteger(process.env[marketKey] || (legacyKey && process.env[legacyKey]), fallback, {
    min: 100,
    max: 1000000000
  })
}

const planPrices = {
  NG: { studio: 750000, scale: 2200000, partner: 6000000 },
  GB: { studio: 5900, scale: 14900, partner: 39900 },
  US: { studio: 6900, scale: 17900, partner: 44900 },
  CA: { studio: 8900, scale: 22900, partner: 56900 }
}

const getStripePriceId = (marketCode, planCode) => {
  const market = getMarketDefinition(marketCode)
  const scoped = String(process.env[`STRIPE_${market.code}_SELLER_${planCode.toUpperCase()}_PRICE_ID`] || '').trim()
  if (scoped) return scoped
  return market.code === 'GB'
    ? String(process.env[`STRIPE_SELLER_${planCode.toUpperCase()}_PRICE_ID`] || '').trim()
    : ''
}

const getSellerPlans = (marketCode) => {
  const market = getMarketDefinition(marketCode)
  const prices = planPrices[market.code]

  return [
    {
      code: 'starter',
      label: 'Starter',
      description: market.code === 'NG'
        ? 'A generous free start for emerging Nigerian beauty entrepreneurs.'
        : 'A verified entry tier for independent sellers building their first Glory catalogue.',
      feeMinor: 0,
      feePence: 0,
      currency: market.currency,
      marketCode: market.code,
      billingProvider: market.billingProvider,
      interval: null,
      activeListingLimit: market.starterListingLimit,
      promotionDiscountBps: 0,
      reviewPriority: 'standard',
      features: [`Up to ${market.starterListingLimit} active listings`, 'Buyer enquiries and verified-interaction reviews', 'Standard listing review']
    },
    {
      code: 'studio',
      label: 'Studio',
      description: 'For growing beauty businesses that need meaningful catalogue capacity and lower campaign costs.',
      feeMinor: readPlanPrice(market.code, 'studio', prices.studio),
      feePence: readPlanPrice(market.code, 'studio', prices.studio),
      currency: market.currency,
      marketCode: market.code,
      billingProvider: market.billingProvider,
      interval: 'month',
      activeListingLimit: 50,
      promotionDiscountBps: 1000,
      reviewPriority: 'priority',
      stripePriceId: getStripePriceId(market.code, 'studio'),
      features: ['Up to 50 active listings', '10% off paid visibility', 'Priority listing review queue']
    },
    {
      code: 'scale',
      label: 'Scale',
      description: 'For established sellers running a broad catalogue and regular acquisition campaigns.',
      feeMinor: readPlanPrice(market.code, 'scale', prices.scale),
      feePence: readPlanPrice(market.code, 'scale', prices.scale),
      currency: market.currency,
      marketCode: market.code,
      billingProvider: market.billingProvider,
      interval: 'month',
      activeListingLimit: 200,
      promotionDiscountBps: 2000,
      reviewPriority: 'priority',
      stripePriceId: getStripePriceId(market.code, 'scale'),
      features: ['Up to 200 active listings', '20% off paid visibility', 'Priority listing review queue']
    },
    {
      code: 'partner',
      label: 'Brand Partner',
      description: 'For high-volume brands that need extensive inventory capacity and managed campaign support.',
      feeMinor: readPlanPrice(market.code, 'partner', prices.partner),
      feePence: readPlanPrice(market.code, 'partner', prices.partner),
      currency: market.currency,
      marketCode: market.code,
      billingProvider: market.billingProvider,
      interval: 'month',
      activeListingLimit: 750,
      promotionDiscountBps: 2500,
      reviewPriority: 'priority',
      stripePriceId: getStripePriceId(market.code, 'partner'),
      features: ['Up to 750 active listings', '25% off paid visibility', 'Managed campaign support']
    }
  ]
}

const getSellerPlan = (code, marketCode) => (
  getSellerPlans(marketCode).find((plan) => plan.code === String(code || '').trim().toLowerCase()) || null
)

const promotionPrices = {
  NG: { spotlight7: 500000, spotlight30: 1500000, video7: 2500000, video30: 7500000 },
  GB: { spotlight7: 8900, spotlight30: 24900, video7: 19900, video30: 54900 },
  US: { spotlight7: 9900, spotlight30: 27900, video7: 24900, video30: 69900 },
  CA: { spotlight7: 12900, spotlight30: 34900, video7: 31900, video30: 84900 }
}

const readPromotionPrice = (marketCode, key, fallback) => readInteger(
  process.env[`${marketCode}_HOMEPAGE_${key}_FEE_MINOR`]
    || (marketCode === 'GB' ? process.env[`HOMEPAGE_${key}_FEE_PENCE`] : undefined),
  fallback,
  { min: 100, max: 1000000000 }
)

const getPromotionPlans = (marketCode) => {
  const market = getMarketDefinition(marketCode)
  const prices = promotionPrices[market.code]
  const buildPlan = ({ code, placement, label, description, amount, durationDays, recommended = false }) => ({
    code,
    placement,
    label,
    description,
    feeMinor: amount,
    feePence: amount,
    currency: market.currency,
    marketCode: market.code,
    billingProvider: market.billingProvider,
    durationDays,
    recommended,
    requiresCreative: placement === 'homepage_video'
  })

  return [
    buildPlan({
      code: 'homepage_spotlight_7',
      placement: 'homepage_featured',
      label: 'Homepage Spotlight',
      description: "One approved listing in Glory's clearly labelled Sponsored homepage edit for 7 days.",
      amount: readPromotionPrice(market.code, 'SPOTLIGHT_7', prices.spotlight7),
      durationDays: 7,
      recommended: true
    }),
    buildPlan({
      code: 'homepage_spotlight_30',
      placement: 'homepage_featured',
      label: 'Homepage Spotlight 30',
      description: "One approved listing in Glory's clearly labelled Sponsored homepage edit for 30 days.",
      amount: readPromotionPrice(market.code, 'SPOTLIGHT_30', prices.spotlight30),
      durationDays: 30
    }),
    buildPlan({
      code: 'homepage_video_7',
      placement: 'homepage_video',
      label: 'Homepage Video',
      description: 'A reviewed, clearly labelled video campaign for one approved listing for 7 days.',
      amount: readPromotionPrice(market.code, 'VIDEO_7', prices.video7),
      durationDays: 7
    }),
    buildPlan({
      code: 'homepage_video_30',
      placement: 'homepage_video',
      label: 'Homepage Video 30',
      description: 'A reviewed, clearly labelled video campaign for one approved listing for 30 days.',
      amount: readPromotionPrice(market.code, 'VIDEO_30', prices.video30),
      durationDays: 30
    })
  ]
}

const getPromotionPlan = (code, marketCode) => (
  getPromotionPlans(marketCode).find((plan) => plan.code === String(code || '').trim()) || null
)

const getEffectiveSellerPlan = (sellerProfile = {}) => {
  const marketCode = normalizeMarketCode(sellerProfile.marketCode, 'GB')
  const requested = getSellerPlan(sellerProfile.membershipPlanCode, marketCode)
  if (!requested || requested.code === 'starter') return getSellerPlan('starter', marketCode)
  const periodEnd = sellerProfile.membershipCurrentPeriodEnd
    ? new Date(sellerProfile.membershipCurrentPeriodEnd).getTime()
    : null
  const periodExpired = Number.isFinite(periodEnd) && periodEnd <= Date.now()
  return sellerProfile.membershipStatus === 'active' && !periodExpired
    ? requested
    : getSellerPlan('starter', marketCode)
}

const pricePromotionForSeller = (promotionPlan, sellerProfile = {}) => {
  const sellerPlan = getEffectiveSellerPlan({ ...sellerProfile, marketCode: promotionPlan.marketCode })
  const discountMinor = Math.floor(
    Number(promotionPlan.feeMinor) * Number(sellerPlan.promotionDiscountBps || 0) / 10000
  )
  return {
    baseFeeMinor: promotionPlan.feeMinor,
    baseFeePence: promotionPlan.feeMinor,
    discountMinor,
    discountPence: discountMinor,
    feeMinor: Math.max(100, promotionPlan.feeMinor - discountMinor),
    feePence: Math.max(100, promotionPlan.feeMinor - discountMinor),
    sellerPlanCode: sellerPlan.code
  }
}

const normalizePaymentMethods = (methods, fallback = ['card'], marketCode) => {
  if (!Array.isArray(methods)) return [...fallback]
  const allowed = new Set(getSellerAcceptedPaymentMethods(marketCode).map((method) => method.code))
  const unique = [...new Set(methods.map((method) => String(method).trim().toLowerCase()))]
  const supported = unique.filter((method) => KNOWN_PAYMENT_METHODS.includes(method) && allowed.has(method))
  return supported.length ? supported : [...fallback]
}

const orderValueToMethodCode = (value, marketCode) => {
  const orderMap = { Stripe: 'card', Paystack: 'card', PayOnDelivery: 'cash_on_delivery', Crypto: 'crypto' }
  const method = orderMap[value] || null
  if (!method) return null
  const allowed = new Set(getSellerAcceptedPaymentMethods(marketCode).map((item) => item.code))
  return allowed.has(method) ? method : null
}

const getPublicMarkets = () => MARKET_CODES.map((code) => {
  const market = marketDefinitions[code]
  return {
    code: market.code,
    slug: market.slug,
    name: market.name,
    locale: market.locale,
    currency: market.currency,
    currencyName: market.currencyName,
    billingProvider: market.billingProvider
  }
})

module.exports = {
  KNOWN_PAYMENT_METHODS,
  MARKET_CODES,
  getDefaultMarketCode,
  getEffectiveSellerPlan,
  getMarketDefinition,
  getMarketplaceConfig,
  getPromotionPlans,
  getPromotionPlan,
  getPublicMarkets,
  getSellerAcceptedPaymentMethods,
  getSellerPlan,
  getSellerPlans,
  normalizeMarketCode,
  normalizePaymentMethods,
  orderValueToMethodCode,
  pricePromotionForSeller
}
