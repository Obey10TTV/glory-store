const path = require('node:path')
const { Worker } = require('node:worker_threads')
const sharp = require('sharp')
const { fileMatchesAllowedType } = require('./fileValidation')

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const DOCUMENT_TYPES = ['application/pdf', ...IMAGE_TYPES]
const CREATIVE_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES]

const invalidFile = (message) => Object.assign(new Error(message), { statusCode: 400 })

const normalizeImage = async (file) => {
  if (!fileMatchesAllowedType(file, IMAGE_TYPES)) {
    throw invalidFile('Upload a valid JPG, PNG or WebP image.')
  }
  try {
    const image = sharp(file.buffer, { failOn: 'warning', limitInputPixels: 24_000_000 })
    const metadata = await image.metadata()
    if (metadata.pages > 1 || `image/${metadata.format}` !== file.mimetype) {
      throw invalidFile('Upload a still JPG, PNG or WebP image.')
    }
    return await image.rotate().resize({
      width: 2400,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: true
    }).webp({ quality: 90 }).timeout({ seconds: 10 }).toBuffer()
  } catch (error) {
    if (error.statusCode === 400) throw error
    throw invalidFile('This image could not be decoded. Upload an undamaged JPG, PNG or WebP.')
  }
}

const normalizePdf = (buffer) => new Promise((resolve, reject) => {
  const bytes = Uint8Array.from(buffer)
  const worker = new Worker(path.join(__dirname, 'uploadPdfWorker.js'), {
    workerData: bytes,
    transferList: [bytes.buffer],
    resourceLimits: { maxOldGenerationSizeMb: 96 }
  })
  const invalidPdf = () => invalidFile('Upload a readable, unlocked PDF with no more than 10 pages.')
  const timer = setTimeout(() => {
    void worker.terminate()
    reject(invalidPdf())
  }, 20_000)

  worker.once('message', (result) => {
    clearTimeout(timer)
    if (result instanceof Uint8Array) resolve(Buffer.from(result))
    else reject(invalidPdf())
    void worker.terminate()
  })
  worker.once('error', () => {
    clearTimeout(timer)
    reject(invalidPdf())
  })
  worker.once('exit', () => {
    clearTimeout(timer)
    reject(invalidPdf())
  })
})

const normalizeVerificationDocument = async (file) => {
  if (!fileMatchesAllowedType(file, DOCUMENT_TYPES)) {
    throw invalidFile('Upload a valid PDF, JPG, PNG or WebP document.')
  }
  if (file.mimetype === 'application/pdf') {
    return { buffer: await normalizePdf(file.buffer), mimeType: 'application/pdf', resourceType: 'raw', format: 'pdf' }
  }
  return { buffer: await normalizeImage(file), mimeType: 'image/webp', resourceType: 'image', format: 'webp' }
}

const campaignVideoTransform = (frame) => [
  frame,
  { fetch_format: 'mp4', video_codec: 'h264', audio_codec: 'aac' }
]

const isNormalizedCampaignVideo = (asset) => (
  asset?.resource_type === 'video'
  && asset.format === 'mp4'
  && Number(asset.width) > 0
  && Number(asset.height) > 0
  && Number.isFinite(Number(asset.duration))
  && Number(asset.duration) > 0
  && Number(asset.duration) <= 10.5
)

module.exports = {
  IMAGE_TYPES, VIDEO_TYPES, DOCUMENT_TYPES, CREATIVE_TYPES,
  normalizeImage, normalizeVerificationDocument, campaignVideoTransform, isNormalizedCampaignVideo
}
