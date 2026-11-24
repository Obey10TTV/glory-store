const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { PDFDocument, PDFName, StandardFonts } = require('pdf-lib')
const cloudinary = require('cloudinary').v2
const {
  normalizeImage, normalizeVerificationDocument, campaignVideoTransform, isNormalizedCampaignVideo
} = require('../utils/uploadContent')

const upload = (buffer, mimetype, originalname) => ({ buffer, mimetype, originalname })

test('an image name and media type do not allow arbitrary or truncated bytes', async () => {
  const fakeImage = upload(Buffer.from('plain text'), 'image/jpeg', 'product.jpg')
  const truncatedImage = upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1]), 'image/jpeg', 'product.jpg')
  await assert.rejects(normalizeImage(fakeImage), { statusCode: 400 })
  await assert.rejects(normalizeImage(truncatedImage), { statusCode: 400 })
})

test('image uploads preserve transparency but discard bytes appended to the image', async () => {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 220, g: 120, b: 40, alpha: 0.5 } }
  }).png().toBuffer()
  const suffix = Buffer.from('unrelated data after the image')
  const image = await normalizeImage(upload(Buffer.concat([png, suffix]), 'image/png', 'product.png'))
  const metadata = await sharp(image).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.hasAlpha, true)
  assert.equal(metadata.width, 4)
  assert.equal(image.includes(suffix), false)
})

test('seller PDFs are rebuilt from rendered pages without original metadata or attachments', async () => {
  const source = await PDFDocument.create()
  const font = await source.embedFont(StandardFonts.Helvetica)
  source.setTitle('private upload metadata')
  await source.attach(Buffer.from('test attachment contents'), 'attachment.txt')
  source.addPage([300, 400]).drawText('Sample business verification', { x: 10, y: 200, font })
  source.addPage([500, 300])

  const result = await normalizeVerificationDocument(
    upload(Buffer.from(await source.save()), 'application/pdf', 'document.pdf')
  )
  assert.equal(result.format, 'pdf')
  assert.equal(result.resourceType, 'raw')
  const rebuilt = await PDFDocument.load(result.buffer)
  assert.equal(rebuilt.getPageCount(), 2)
  assert.deepEqual(rebuilt.getPage(0).getSize(), { width: 300, height: 400 })
  const images = rebuilt.getPage(0).node.Resources().lookup(PDFName.of('XObject')).values()
  const pageImage = rebuilt.context.lookup(images[0]).getContents()
  const pixels = await sharp(pageImage).greyscale().raw().toBuffer()
  assert.ok(pixels.some((pixel) => pixel < 100), 'Rendered page must contain visible text')
  assert.equal(rebuilt.getTitle(), undefined)
  assert.equal(rebuilt.catalog.has(PDFName.of('Names')), false)
})

test('invalid seller PDFs and PDFs above the page limit are rejected', async () => {
  await assert.rejects(normalizeVerificationDocument(
    upload(Buffer.from('%PDF-1.7\nplain text'), 'application/pdf', 'document.pdf')
  ), { statusCode: 400 })
  const oversized = await PDFDocument.create()
  for (let page = 0; page < 11; page++) oversized.addPage()
  await assert.rejects(normalizeVerificationDocument(
    upload(Buffer.from(await oversized.save()), 'application/pdf', 'document.pdf')
  ), { statusCode: 400 })
})

test('campaign video uploads request MP4 conversion and require a short usable output', () => {
  const transformation = cloudinary.utils.generate_transformation_string({
    transformation: campaignVideoTransform({ width: 1440, height: 1440, crop: 'limit' })
  })
  assert.match(transformation, /(?:^|[,/])f_mp4(?:$|[,/])/)
  assert.match(transformation, /(?:^|[,/])vc_h264(?:$|[,/])/)
  assert.match(transformation, /(?:^|[,/])ac_aac(?:$|[,/])/)
  const asset = { resource_type: 'video', format: 'mp4', width: 640, height: 480, duration: 10 }
  assert.equal(isNormalizedCampaignVideo(asset), true)
  assert.equal(isNormalizedCampaignVideo({ ...asset, format: 'webm' }), false)
  assert.equal(isNormalizedCampaignVideo({ ...asset, duration: 11 }), false)
  assert.equal(isNormalizedCampaignVideo({ ...asset, height: 0 }), false)
})
