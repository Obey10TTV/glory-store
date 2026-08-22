const express = require('express')
const User = require('../models/user')
const { protect, seller } = require('../middleware/auth')
const { getSellerCommerceStatus } = require('../services/stripeMarketplaceService')
const {
  getMarketplaceConfig,
  getPromotionPlans,
  getPublicMarkets,
  getSellerPlans,
  normalizeMarketCode
} = require('../services/marketplaceService')
const { getSuiConfig } = require('../utils/suiConfig')

const router = express.Router()

const publicSellerPlan = (plan) => ({
  code: plan.code,
  label: plan.label,
  description: plan.description,
  feeMinor: plan.feeMinor,
  currency: plan.currency,
  marketCode: plan.marketCode,
  billingProvider: plan.billingProvider,
  interval: plan.interval,
  activeListingLimit: plan.activeListingLimit,
  promotionDiscountBps: plan.promotionDiscountBps,
  features: plan.features
})

const publicPromotionPlan = (plan) => ({
  code: plan.code,
  placement: plan.placement,
  label: plan.label,
  description: plan.description,
  feeMinor: plan.feeMinor,
  currency: plan.currency,
  marketCode: plan.marketCode,
  billingProvider: plan.billingProvider,
  durationDays: plan.durationDays,
  recommended: plan.recommended,
  requiresCreative: plan.requiresCreative
})

router.get('/markets', (req, res) => {
  res.json({
    defaultMarketCode: normalizeMarketCode(process.env.DEFAULT_MARKET_CODE, 'NG'),
    items: getPublicMarkets()
  })
})

router.get('/config', (req, res) => {
  const marketCode = normalizeMarketCode(req.query.market, 'NG')
  const marketplace = getMarketplaceConfig(marketCode)
  res.json({
    ...marketplace,
    sellerPlans: getSellerPlans(marketCode).map(publicSellerPlan),
    promotionPlans: getPromotionPlans(marketCode).map(publicPromotionPlan)
  })
})

// This deliberately exposes capability status only. It never exposes a key,
// wallet address, or internal RPC configuration to the browser.
router.get('/sui/status', (req, res) => {
  const config = getSuiConfig()
  res.json({
    network: config.network,
    verificationEnabled: config.enabled,
    paymentEnabled: false,
    packageConfigured: Boolean(config.packageId),
    registryConfigured: Boolean(config.registryObjectId)
  })
})

router.get('/seller/status', protect, seller, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
    if (!user?.isSeller) return res.status(403).json({ message: 'Not authorized as seller' })
    const marketCode = normalizeMarketCode(user.sellerProfile?.marketCode, 'GB')
    const marketplace = getMarketplaceConfig(marketCode)
    res.json({
      ...getSellerCommerceStatus(user, marketplace),
      marketCode,
      marketName: marketplace.marketName,
      currency: marketplace.currency,
      billingProvider: marketplace.billingProvider,
      billingEnabled: marketplace.billingEnabled,
      paymentMethods: marketplace.paymentMethods,
      sellerAcceptedPaymentMethods: marketplace.sellerAcceptedPaymentMethods,
      sellerPlans: getSellerPlans(marketCode).map(publicSellerPlan),
      promotionPlans: getPromotionPlans(marketCode).map(publicPromotionPlan)
    })
  } catch (error) {
    res.status(500).json({ message: 'Unable to load regional seller services.' })
  }
})

module.exports = router
