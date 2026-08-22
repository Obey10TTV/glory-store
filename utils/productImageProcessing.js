const PRODUCT_IMAGE_BACKGROUNDS = ['white', 'black', 'berry']

const IMAGE_PROFILES = {
  thumbnail: { width: 320, height: 320, quality: 'auto:good' },
  card: { width: 640, height: 800, quality: 'auto:good' },
  detail: { width: 1120, height: 1120, quality: 'auto:best' },
  highResolution: { width: 1800, height: 1800, quality: 'auto:best' }
}

const isOwnedProductImage = (publicId, userId) => (
  typeof publicId === 'string'
  && publicId.startsWith(`glory-store/products/${userId}/`)
)

const buildTransformation = ({ width, height, quality }) => [
  { effect: 'background_removal' },
  { crop: 'trim' },
  // The first frame deliberately leaves a 5% margin, then the second gives
  // every delivery size a consistent transparent canvas around the product.
  { width: Math.round(width * 0.9), height: Math.round(height * 0.9), crop: 'pad', background: 'transparent', gravity: 'center' },
  { width, height, crop: 'pad', background: 'transparent', gravity: 'center' }
]

const buildProcessingUrls = (cloudinary, publicId) => {
  const urlFor = (profile) => cloudinary.url(publicId, {
    secure: true,
    resource_type: 'image',
    transformation: buildTransformation(profile),
    fetch_format: 'auto',
    quality: profile.quality
  })

  return {
    processedImageUrl: urlFor(IMAGE_PROFILES.detail),
    thumbnailImageUrl: urlFor(IMAGE_PROFILES.thumbnail),
    cardImageUrl: urlFor(IMAGE_PROFILES.card),
    highResolutionImageUrl: urlFor(IMAGE_PROFILES.highResolution)
  }
}

const buildEagerTransformations = () => Object.values(IMAGE_PROFILES).map((profile) => ({
  transformation: buildTransformation(profile),
  fetch_format: 'auto',
  quality: profile.quality
}))

const buildImageProcessingRecord = (cloudinary, {
  originalImageUrl,
  sourcePublicId,
  presentationBackground = 'white',
  useProcessedImage = true,
  processingStatus = 'processing',
  processingError = ''
}) => ({
  originalImageUrl,
  sourcePublicId,
  ...buildProcessingUrls(cloudinary, sourcePublicId),
  backgroundRemoved: false,
  processingStatus,
  processingError,
  useProcessedImage,
  presentationBackground: PRODUCT_IMAGE_BACKGROUNDS.includes(presentationBackground)
    ? presentationBackground
    : 'white'
})

const prepareProductImageProcessing = (cloudinary, value, { originalImageUrl, userId, isAdmin = false }) => {
  const sourcePublicId = String(value?.sourcePublicId || '').trim()
  const presentationBackground = value?.presentationBackground
  const useProcessedImage = value?.useProcessedImage !== false

  if (!sourcePublicId || (!isAdmin && !isOwnedProductImage(sourcePublicId, userId))) {
    return {
      originalImageUrl,
      processedImageUrl: '',
      thumbnailImageUrl: '',
      cardImageUrl: '',
      highResolutionImageUrl: '',
      sourcePublicId: '',
      backgroundRemoved: false,
      processingStatus: 'not_requested',
      processingError: '',
      useProcessedImage: false,
      presentationBackground: PRODUCT_IMAGE_BACKGROUNDS.includes(presentationBackground)
        ? presentationBackground
        : 'white'
    }
  }

  return buildImageProcessingRecord(cloudinary, {
    originalImageUrl,
    sourcePublicId,
    presentationBackground,
    useProcessedImage,
    processingStatus: value?.processingStatus === 'failed' ? 'failed' : 'processing',
    processingError: value?.processingStatus === 'failed'
      ? String(value?.processingError || 'Glory Optimised could not be prepared.').slice(0, 240)
      : ''
  })
}

module.exports = {
  PRODUCT_IMAGE_BACKGROUNDS,
  buildEagerTransformations,
  buildImageProcessingRecord,
  isOwnedProductImage,
  prepareProductImageProcessing
}
