const express = require('express')
const router = express.Router()
const cloudinary = require('cloudinary').v2
const multer = require('multer')
const { protect } = require('../middleware/auth')
const User = require('../models/user')

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})


// Use memory storage
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'))
    }
  }
})

const sellerDocumentUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    cb(allowedTypes.includes(file.mimetype) ? null : new Error('Only PDF, JPG, PNG or WebP documents are allowed'), allowedTypes.includes(file.mimetype))
  }
})

const runUpload = (middleware) => (req, res, next) => {
  middleware(req, res, (error) => {
    if (error) return res.status(400).json({ message: error.message })
    next()
  })
}

const uploadBuffer = (buffer, options) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) reject(error)
    else resolve(result)
  })
  stream.end(buffer)
})

// UPLOAD IMAGE - POST /api/upload
router.post('/', protect, runUpload(upload.single('image')), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' })
    }

    // Convert buffer to base64
    const fileStr = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`

    // Upload to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload(fileStr, {
      folder: 'glory-store',
      transformation: [
        { width: 800, height: 800, crop: 'limit' },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    })

    res.json({
      message: 'Image uploaded successfully',
      url: uploadResponse.secure_url,
      public_id: uploadResponse.public_id
    })

  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.post('/seller-document', protect, runUpload(sellerDocumentUpload.single('document')), async (req, res) => {
  try {
    const documentType = String(req.body.type || '').toLowerCase()
    if (!req.user.isSeller) {
      return res.status(403).json({ message: 'Only seller accounts can upload verification documents' })
    }
    if (!['identity', 'business', 'address'].includes(documentType)) {
      return res.status(400).json({ message: 'Choose a valid document type' })
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No verification document provided' })
    }

    const resourceType = req.file.mimetype === 'application/pdf' ? 'raw' : 'image'
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: `glory-store/private/seller-${req.user._id}`,
      type: 'authenticated',
      resource_type: resourceType,
      use_filename: false,
      unique_filename: true
    })

    const user = await User.findById(req.user._id)
    if (!user) return res.status(404).json({ message: 'User not found' })

    const existing = user.sellerProfile.documents.find(doc => doc.type === documentType)
    if (existing) {
      await cloudinary.uploader.destroy(existing.publicId, {
        resource_type: existing.resourceType,
        type: 'authenticated',
        invalidate: true
      }).catch(() => {})
      existing.publicId = uploaded.public_id
      existing.resourceType = resourceType
      existing.format = uploaded.format || (resourceType === 'raw' ? 'pdf' : '')
      existing.originalName = req.file.originalname
      existing.mimeType = req.file.mimetype
      existing.status = 'pending'
      existing.note = ''
      existing.uploadedAt = new Date()
      existing.reviewedAt = undefined
      existing.reviewedBy = undefined
    } else {
      user.sellerProfile.documents.push({
        type: documentType,
        publicId: uploaded.public_id,
        resourceType,
        format: uploaded.format || (resourceType === 'raw' ? 'pdf' : ''),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype
      })
    }
    user.sellerProfile.verificationStatus = 'incomplete'
    user.sellerProfile.auditTrail.push({ action: 'document_uploaded', note: documentType, actor: user._id })
    await user.save()

    const savedDocument = user.sellerProfile.documents.find(doc => doc.type === documentType)
    res.status(201).json({
      message: 'Document uploaded privately for review',
      document: {
        _id: savedDocument._id,
        type: savedDocument.type,
        originalName: savedDocument.originalName,
        status: savedDocument.status,
        uploadedAt: savedDocument.uploadedAt
      }
    })
  } catch (error) {
    res.status(error instanceof multer.MulterError ? 400 : 500).json({ message: error.message })
  }
})

module.exports = router
