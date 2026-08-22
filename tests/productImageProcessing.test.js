const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildImageProcessingRecord,
  isOwnedProductImage,
  prepareProductImageProcessing
} = require('../utils/productImageProcessing')

const cloudinary = {
  url: (publicId, options) => `https://images.example.test/${encodeURIComponent(publicId)}?width=${options.transformation.at(-1).width}`
}

test('product image processing keeps four responsive delivery profiles', () => {
  const record = buildImageProcessingRecord(cloudinary, {
    originalImageUrl: 'https://res.cloudinary.com/glory/image/upload/original.jpg',
    sourcePublicId: 'glory-store/products/seller-1/product-1'
  })

  assert.equal(record.originalImageUrl, 'https://res.cloudinary.com/glory/image/upload/original.jpg')
  assert.equal(record.processingStatus, 'processing')
  assert.equal(record.thumbnailImageUrl.endsWith('width=320'), true)
  assert.equal(record.cardImageUrl.endsWith('width=640'), true)
  assert.equal(record.processedImageUrl.endsWith('width=1120'), true)
  assert.equal(record.highResolutionImageUrl.endsWith('width=1800'), true)
})

test('seller image source ids are scoped to the uploading seller', () => {
  assert.equal(isOwnedProductImage('glory-store/products/seller-1/product-1', 'seller-1'), true)
  assert.equal(isOwnedProductImage('glory-store/products/seller-2/product-1', 'seller-1'), false)

  const record = prepareProductImageProcessing(cloudinary, {
    sourcePublicId: 'glory-store/products/seller-2/product-1',
    useProcessedImage: true
  }, {
    originalImageUrl: 'https://res.cloudinary.com/glory/image/upload/original.jpg',
    userId: 'seller-1'
  })

  assert.equal(record.processingStatus, 'not_requested')
  assert.equal(record.useProcessedImage, false)
  assert.equal(record.processedImageUrl, '')
})
