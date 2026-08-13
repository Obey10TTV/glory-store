const CATEGORY_PRODUCT_TYPES = Object.freeze({
  Skincare: [
    'Cleanser',
    'Toner',
    'Serum',
    'Moisturiser',
    'Face Mask',
    'SPF',
    'Exfoliant',
    'Eye Care',
    'Lip Care',
    'Other Skincare'
  ],
  Haircare: [
    'Shampoo',
    'Conditioner',
    'Leave-in Conditioner',
    'Hair Oil',
    'Hair Mask',
    'Scalp Treatment',
    'Growth Serum',
    'Styling Product',
    'Heat Protectant',
    'Hair Colour',
    'Other Haircare'
  ],
  Makeup: [
    'Foundation',
    'Concealer',
    'Powder',
    'Blush',
    'Bronzer',
    'Highlighter',
    'Eyeshadow',
    'Eyeliner',
    'Mascara',
    'Lipstick',
    'Lip Gloss',
    'Setting Spray',
    'Other Makeup'
  ],
  Nails: [
    'Nail Polish',
    'Gel Polish',
    'Nail Treatment',
    'Press-on Nails',
    'Nail Extension',
    'Nail Care Tool',
    'Other Nails'
  ],
  Lashes: [
    'Strip Lashes',
    'Individual Lashes',
    'Lash Extension',
    'Lash Adhesive',
    'Lash Care',
    'Other Lashes'
  ],
  'Body Care': [
    'Body Wash',
    'Body Lotion',
    'Body Butter',
    'Body Scrub',
    'Deodorant',
    'Hand Care',
    'Other Body Care'
  ],
  'Body Liquid': [
    'Body Oil',
    'Body Mist',
    'Bath Oil',
    'Shower Oil',
    'Other Body Liquid'
  ],
  Fragrance: [
    'Eau de Parfum',
    'Eau de Toilette',
    'Perfume Oil',
    'Fragrance Mist',
    'Gift Set',
    'Other Fragrance'
  ],
  'Scented Candles': [
    'Jar Candle',
    'Pillar Candle',
    'Wax Melt',
    'Candle Gift Set',
    'Other Home Fragrance'
  ],
  'Tools & Accessories': [
    'Brush',
    'Applicator',
    'Beauty Device',
    'Storage',
    'Hair Tool',
    'Other Tool'
  ]
})

const productTypeAliases = Object.freeze({
  Haircare: {
    conditioners: 'Conditioner',
    shampoo: 'Shampoo',
    shampoos: 'Shampoo',
    'leave in conditioner': 'Leave-in Conditioner',
    'leave-in': 'Leave-in Conditioner',
    'hair oils': 'Hair Oil',
    'hair masks': 'Hair Mask',
    'growth serums': 'Growth Serum',
    'heat protectants': 'Heat Protectant'
  },
  Skincare: {
    moisturizers: 'Moisturiser',
    moisturizer: 'Moisturiser',
    'face masks': 'Face Mask',
    sunscreens: 'SPF',
    sunscreen: 'SPF',
    exfoliants: 'Exfoliant',
    cleansers: 'Cleanser',
    serums: 'Serum'
  },
  Makeup: {
    lipsticks: 'Lipstick',
    'lip glosses': 'Lip Gloss',
    foundations: 'Foundation',
    concealers: 'Concealer'
  }
})

const normalizeKey = (value = '') => String(value)
  .trim()
  .toLowerCase()
  .replace(/[–—-]/g, ' ')
  .replace(/\s+/g, ' ')

const getProductTypes = (category) => CATEGORY_PRODUCT_TYPES[String(category || '').trim()] || []

const canonicalizeProductType = (category, productType) => {
  const value = String(productType || '').trim()
  const types = getProductTypes(category)
  if (!value || !types.length) return ''

  const exact = types.find((type) => normalizeKey(type) === normalizeKey(value))
  if (exact) return exact

  return productTypeAliases[String(category || '').trim()]?.[normalizeKey(value)] || ''
}

const isValidProductType = (category, productType) => (
  Boolean(canonicalizeProductType(category, productType))
)

const isCosmeticsCategory = (category) => !['Scented Candles', 'Tools & Accessories'].includes(category)

module.exports = {
  CATEGORY_PRODUCT_TYPES,
  canonicalizeProductType,
  getProductTypes,
  isCosmeticsCategory,
  isValidProductType
}
