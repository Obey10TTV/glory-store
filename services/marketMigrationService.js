const Product = require('../models/product')
const Promotion = require('../models/promotion')
const SystemMigration = require('../models/systemMigration')
const User = require('../models/user')

const GLOBAL_MARKETS_MIGRATION = 'global-markets-v1'

const dropLegacyPromotionSlotIndex = async () => {
  const indexes = await Promotion.collection.indexes()
  const legacy = indexes.find((index) => (
    index.unique
    && index.key?.placement === 1
    && index.key?.slotNumber === 1
    && index.key?.marketCode === undefined
  ))
  if (legacy) await Promotion.collection.dropIndex(legacy.name)
}

const migrateLegacyMarketplaceRecords = async () => {
  if (await SystemMigration.exists({ key: GLOBAL_MARKETS_MIGRATION })) return false

  const [productMarketResult, productCurrencyResult] = await Promise.all([
    Product.updateMany(
      { $or: [{ marketCode: { $exists: false } }, { marketCode: null }] },
      { $set: { marketCode: 'GB' } }
    ),
    Product.updateMany(
      { $or: [{ currency: { $exists: false } }, { currency: null }] },
      { $set: { currency: 'GBP' } }
    )
  ])
  const sellerResult = await User.updateMany(
    {
      isSeller: true,
      $or: [
        { 'sellerProfile.marketCode': { $exists: false } },
        { 'sellerProfile.marketCode': null }
      ]
    },
    {
      $set: {
        'sellerProfile.marketCode': 'GB',
        'sellerProfile.activationCurrency': 'GBP',
        'sellerProfile.membershipCurrency': 'GBP',
        'sellerProfile.membershipProvider': 'stripe'
      }
    }
  )
  const promotionResult = await Promotion.updateMany(
    { $or: [{ marketCode: { $exists: false } }, { marketCode: null }] },
    {
      $set: {
        marketCode: 'GB',
        creativeType: 'listing',
        creativeReviewStatus: 'not_required'
      }
    }
  )

  await dropLegacyPromotionSlotIndex()
  await Promotion.syncIndexes()

  try {
    await SystemMigration.create({
      key: GLOBAL_MARKETS_MIGRATION,
      details: `Prepared ${Math.max(productMarketResult.modifiedCount, productCurrencyResult.modifiedCount)} listings, ${sellerResult.modifiedCount} sellers and ${promotionResult.modifiedCount} promotions for regional markets.`
    })
  } catch (error) {
    if (error?.code !== 11000) throw error
  }
  return true
}

module.exports = {
  GLOBAL_MARKETS_MIGRATION,
  migrateLegacyMarketplaceRecords
}
