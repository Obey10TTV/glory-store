const express = require('express')
const router = express.Router()
const cloudinary = require('cloudinary').v2
const multer = require('multer')
const { randomUUID } = require('node:crypto')
const { protect, verifiedSeller } = require('../middleware/auth')
const User = require('../models/user')
const {
  SELLER_DOCUMENT_TYPES,
  isValidSellerDocumentKind
} = require('../utils/sellerVerification')
const { fileMatchesAllowedType, safeOriginalName } = require('../utils/fileValidation')
const {
  IMAGE_TYPES, VIDEO_TYPES, DOCUMENT_TYPES, CREATIVE_TYPES,
  normalizeImage, normalizeVerificationDocument, campaignVideoTransform, isNormalizedCampaignVideo
} = require('../utils/uploadContent')
const {
  buildEagerTransformations,
  buildImageProcessingRecord,
  isOwnedProductImage
} = require('../utils/productImageProcessing')

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})


const storage = multer.memoryStorage()
const createUpload = (fileSize, allowedTypes, message) => multer({
  storage,
  limits: { fileSize: fileSize * 1024 * 1024, files: 1, fields: 5, fieldSize: 1024, parts: 8 },
  fileFilter: (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) return cb(new Error(message))
    cb(null, true)
  }
})

const upload = createUpload(5, IMAGE_TYPES, 'Only JPG, PNG or WebP images are allowed')
const sellerDocumentUpload = createUpload(8, DOCUMENT_TYPES, 'Only PDF, JPG, PNG or WebP documents are allowed')
const promotionMediaUpload = createUpload(25, VIDEO_TYPES, 'Use an MP4 or WebM campaign video')
const heroCreativeUpload = createUpload(25, CREATIVE_TYPES, 'Use a JPG, PNG, WebP, MP4 or WebM campaign creative')

const MAX_IN_FLIGHT_UPLOADS = 2
let uploadsInFlight = 0
const runUpload = (middleware, handler) => (req, res, next) => {
  if (uploadsInFlight >= MAX_IN_FLIGHT_UPLOADS) {
    return res.set('Retry-After', '5').status(503).json({ message: 'Uploads are busy. Please try again shortly.' })
  }
  uploadsInFlight++
  let parsing = true
  const releaseAbortedRequest = () => {
    if (!parsing) return
    parsing = false
    uploadsInFlight--
  }
  res.once('close', releaseAbortedRequest)
  middleware(req, res, async (error) => {
    if (!parsing) return
    parsing = false
    res.removeListener('close', releaseAbortedRequest)
    try {
      if (error) return res.status(400).json({ message: error.message })
      await handler(req, res)
    } catch (handlerError) {
      next(handlerError)
    } finally {
      uploadsInFlight--
    }
  })
}

const uploadBuffer = (buffer, options) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) reject(error)
    else resolve(result)
  })
  stream.on('error', reject)
  stream.end(buffer)
})

const respondToUploadError = (res, error, message) => {
  if (error instanceof multer.MulterError || error.statusCode === 400) {
    return res.status(400).json({ message: error.message })
  }
  return res.status(500).json({ message })
}

const destroyAsset = (publicId, resourceType, type = 'upload') => cloudinary.uploader.destroy(publicId, {
  resource_type: resourceType,
  type,
  invalidate: true
}).catch(() => {})

// UPLOAD IMAGE - POST /api/upload
router.post('/', protect, runUpload(upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' })
    }
    const image = await normalizeImage(req.file)

    const isPrimaryProductImage = req.body.purpose === 'product_primary'
    const productFolder = `glory-store/products/${req.user._id}`

    // The normalized image is the source for all marketplace delivery variants.
    const uploadResponse = await uploadBuffer(image, {
      folder: isPrimaryProductImage ? productFolder : 'glory-store',
      resource_type: 'image',
      ...(isPrimaryProductImage ? {} : {
        transformation: [
          { width: 800, height: 800, crop: 'limit' },
          { quality: 'auto' }
        ]
      })
    })

    let imageProcessing
    if (isPrimaryProductImage && isOwnedProductImage(uploadResponse.public_id, req.user._id.toString())) {
      try {
        await cloudinary.uploader.explicit(uploadResponse.public_id, {
          type: 'upload',
          resource_type: 'image',
          eager: buildEagerTransformations(),
          eager_async: true
        })
        imageProcessing = buildImageProcessingRecord(cloudinary, {
          originalImageUrl: uploadResponse.secure_url,
          sourcePublicId: uploadResponse.public_id,
          presentationBackground: req.body.presentationBackground,
          processingStatus: 'processing'
        })
      } catch {
        imageProcessing = buildImageProcessingRecord(cloudinary, {
          originalImageUrl: uploadResponse.secure_url,
          sourcePublicId: uploadResponse.public_id,
          presentationBackground: req.body.presentationBackground,
          useProcessedImage: false,
          processingStatus: 'failed',
          processingError: 'Glory Optimised is unavailable right now. Your original image is saved and will be used.'
        })
      }
    }

    res.json({
      message: 'Image uploaded successfully',
      url: uploadResponse.secure_url,
      imageProcessing
    })

  } catch (error) {
    respondToUploadError(res, error, 'Image upload could not be completed.')
  }
}))

router.post('/reprocess-product-image', protect, verifiedSeller, async (req, res) => {
  try {
    const sourcePublicId = String(req.body.sourcePublicId || '').trim()
    if (!isOwnedProductImage(sourcePublicId, req.user._id.toString())) {
      return res.status(400).json({ message: 'This product image cannot be reprocessed.' })
    }

    await cloudinary.uploader.explicit(sourcePublicId, {
      type: 'upload',
      resource_type: 'image',
      eager: buildEagerTransformations(),
      eager_async: true
    })

    const imageProcessing = buildImageProcessingRecord(cloudinary, {
      originalImageUrl: String(req.body.originalImageUrl || ''),
      sourcePublicId,
      presentationBackground: req.body.presentationBackground,
      useProcessedImage: req.body.useProcessedImage !== false,
      processingStatus: 'processing'
    })

    res.json({ message: 'Glory Optimised image is being prepared', imageProcessing })
  } catch (error) {
    res.status(500).json({ message: 'Glory Optimised could not be reprocessed. Your original image is still available.' })
  }
})

router.post('/seller-document', protect, runUpload(sellerDocumentUpload.single('document'), async (req, res) => {
  try {
    const documentType = String(req.body.type || '').toLowerCase()
    const documentKind = String(req.body.kind || '').toLowerCase()
    if (!req.user.isSeller) {
      return res.status(403).json({ message: 'Only seller accounts can upload verification documents' })
    }
    if (documentType === 'identity') {
      return res.status(410).json({
        message: "Government photo ID must be verified through Glory's hosted identity provider. Glory does not accept direct passport or national-ID uploads."
      })
    }
    if (!SELLER_DOCUMENT_TYPES.includes(documentType) || !isValidSellerDocumentKind(documentType, documentKind)) {
      return res.status(400).json({ message: 'Choose a valid document type' })
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No verification document provided' })
    }
    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    const { buffer, mimeType, resourceType, format } = await normalizeVerificationDocument(req.file)
    const uploaded = await uploadBuffer(buffer, {
      folder: `glory-store/private/seller-${req.user._id}`,
      type: 'authenticated',
      resource_type: resourceType,
      ...(resourceType === 'raw' ? { public_id: `${randomUUID()}.pdf` } : {}),
      overwrite: false,
      use_filename: false,
      unique_filename: true
    })

    const existing = user.sellerProfile.documents.find(doc => doc.type === documentType)
    const previous = existing && { publicId: existing.publicId, resourceType: existing.resourceType }
    user.$where = {
      'sellerProfile.documents': previous
        ? { $elemMatch: { _id: existing._id, publicId: previous.publicId } }
        : { $not: { $elemMatch: { type: documentType } } }
    }
    const documentFields = {
      kind: documentKind,
      publicId: uploaded.public_id,
      resourceType,
      format,
      originalName: safeOriginalName(req.file.originalname),
      mimeType
    }
    if (existing) {
      existing.set({
        ...documentFields,
        status: 'pending',
        note: '',
        uploadedAt: new Date(),
        reviewedAt: undefined,
        reviewedBy: undefined
      })
    } else {
      user.sellerProfile.documents.push({ type: documentType, ...documentFields })
    }
    user.sellerProfile.verificationStatus = 'incomplete'
    user.sellerProfile.auditTrail.push({ action: 'document_uploaded', note: documentType, actor: user._id })
    try {
      await user.save()
    } catch (error) {
      if (['DocumentNotFoundError', 'VersionError', 'ValidationError'].includes(error.name)) {
        await destroyAsset(uploaded.public_id, resourceType, 'authenticated')
      }
      if (['DocumentNotFoundError', 'VersionError'].includes(error.name)) {
        return res.status(409).json({ message: 'Your verification documents changed during upload. Please try again.' })
      }
      throw error
    }
    if (previous) await destroyAsset(previous.publicId, previous.resourceType, 'authenticated')

    const savedDocument = user.sellerProfile.documents.find(doc => doc.type === documentType)
    res.status(201).json({
      message: 'Document uploaded privately for review',
      document: {
        _id: savedDocument._id,
        type: savedDocument.type,
        kind: savedDocument.kind,
        originalName: savedDocument.originalName,
        status: savedDocument.status,
        uploadedAt: savedDocument.uploadedAt
      }
    })
  } catch (error) {
    respondToUploadError(res, error, 'Document upload could not be completed.')
  }
}))

router.post('/promotion-media', protect, verifiedSeller, runUpload(promotionMediaUpload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a campaign video' })
    if (!fileMatchesAllowedType(req.file, VIDEO_TYPES)) {
      return res.status(400).json({ message: 'Upload a valid MP4 or WebM campaign video.' })
    }

    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: `glory-store/promotions/${req.user._id}`,
      resource_type: 'video',
      use_filename: false,
      unique_filename: true,
      transformation: campaignVideoTransform({ width: 1440, height: 1440, crop: 'limit' })
    })

    if (!isNormalizedCampaignVideo(uploaded)) {
      await destroyAsset(uploaded.public_id, 'video')
      return res.status(400).json({ message: 'Upload a readable MP4 or WebM video no longer than 10 seconds.' })
    }

    res.status(201).json({
      message: 'Campaign media uploaded for review',
      url: uploaded.secure_url,
      mediaType: 'video',
      durationSeconds: Number(uploaded.duration)
    })
  } catch (error) {
    respondToUploadError(res, error, 'Campaign media could not be uploaded')
  }
}))

router.post('/promotion-hero-media', protect, verifiedSeller, runUpload(heroCreativeUpload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a campaign image or video.' })
    const isVideo = req.file.mimetype.startsWith('video/')
    if (isVideo && !fileMatchesAllowedType(req.file, VIDEO_TYPES)) {
      return res.status(400).json({ message: 'Upload a valid MP4 or WebM campaign video.' })
    }
    if (!isVideo && req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: 'Campaign images must be 5 MB or smaller.' })
    }

    const image = isVideo ? null : await normalizeImage(req.file)
    const frame = { width: 1672, height: 940, crop: 'fill', gravity: 'auto' }
    const uploaded = await uploadBuffer(image || req.file.buffer, {
      folder: `glory-store/promotions/hero/${req.user._id}`,
      resource_type: isVideo ? 'video' : 'image',
      use_filename: false,
      unique_filename: true,
      transformation: isVideo ? campaignVideoTransform(frame) : [frame, { quality: 'auto' }]
    })

    if (isVideo && !isNormalizedCampaignVideo(uploaded)) {
      await destroyAsset(uploaded.public_id, 'video')
      return res.status(400).json({ message: 'Upload a readable MP4 or WebM video no longer than 10 seconds.' })
    }

    res.status(201).json({
      message: 'Hero campaign creative uploaded for review',
      url: uploaded.secure_url,
      mediaType: isVideo ? 'video' : 'image',
      durationSeconds: isVideo ? Number(uploaded.duration) : 0,
      presentation: { width: 1672, height: 940, aspectRatio: '16:9' },
      moderation: 'Manual Trust & Safety review is required before this creative can be approved.'
    })
  } catch (error) {
    respondToUploadError(res, error, 'Hero campaign media could not be uploaded')
  }
}))

module.exports = router
