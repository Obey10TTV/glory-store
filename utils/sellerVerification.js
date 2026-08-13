const SELLER_DOCUMENT_KINDS = Object.freeze({
  identity: [
    'passport',
    'national_id',
    'biometric_residence_permit',
    'driving_licence',
    'other_government_id'
  ],
  business: [
    'company_registration',
    'sole_trader_declaration',
    'marketplace_reseller_document',
    'other_business_document'
  ],
  tax: [
    'tax_registration',
    'vat_registration',
    'tax_status_declaration'
  ],
  address: [
    'utility_bill',
    'bank_statement',
    'government_letter',
    'other_address_document'
  ],
  insurance: [
    'public_liability',
    'product_liability',
    'other_insurance_document'
  ]
})

const SELLER_DOCUMENT_TYPES = Object.freeze(Object.keys(SELLER_DOCUMENT_KINDS))

const getRequiredSellerDocumentTypes = (sellerProfile = {}) => {
  const required = ['identity', 'business', 'address']
  if (sellerProfile.taxStatus === 'registered') required.push('tax')
  return required
}

const isValidSellerDocumentKind = (type, kind) => (
  SELLER_DOCUMENT_KINDS[type]?.includes(kind) || false
)

module.exports = {
  SELLER_DOCUMENT_KINDS,
  SELLER_DOCUMENT_TYPES,
  getRequiredSellerDocumentTypes,
  isValidSellerDocumentKind
}
