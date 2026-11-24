const { parentPort, workerData } = require('node:worker_threads')
const path = require('node:path')
const { createCanvas } = require('@napi-rs/canvas')
const { PDFDocument } = require('pdf-lib')

const MAX_PAGES = 10
const MAX_EDGE = 1600
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

async function renderCleanPdf(data) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjsDirectory = path.dirname(require.resolve('pdfjs-dist/package.json')).split(path.sep).join('/')
  const loading = getDocument({
    data,
    verbosity: 0,
    stopAtErrors: true,
    isEvalSupported: false,
    enableXfa: false,
    useWasm: false,
    useSystemFonts: false,
    standardFontDataUrl: pdfjsDirectory + '/standard_fonts/',
    cMapUrl: pdfjsDirectory + '/cmaps/',
    maxImageSize: 24_000_000
  })
  try {
    const input = await loading.promise
    if (input.numPages < 1 || input.numPages > MAX_PAGES) throw new Error('Page limit exceeded')
    const output = await PDFDocument.create()
    for (let pageNumber = 1; pageNumber <= input.numPages; pageNumber++) {
      const page = await input.getPage(pageNumber)
      const size = page.getViewport({ scale: 1 })
      const longestEdge = Math.max(size.width, size.height)
      if (!Number.isFinite(longestEdge) || Math.min(size.width, size.height) <= 0 || longestEdge > 14_400) {
        throw new Error('Invalid PDF page size')
      }
      const viewport = page.getViewport({ scale: Math.min(2, MAX_EDGE / longestEdge) })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      try {
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0 }).promise
        const image = await output.embedJpg(canvas.toBuffer('image/jpeg', 86))
        const outputPage = output.addPage([size.width, size.height])
        outputPage.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height })
      } finally {
        canvas.width = canvas.height = 1
        page.cleanup()
      }
    }
    const cleanPdf = await output.save()
    if (cleanPdf.length > MAX_OUTPUT_BYTES) throw new Error('Output size limit exceeded')
    return cleanPdf
  } finally {
    await loading.destroy()
  }
}

renderCleanPdf(workerData).then(
  (cleanPdf) => parentPort.postMessage(cleanPdf, [cleanPdf.buffer]),
  () => parentPort.postMessage(null)
)
