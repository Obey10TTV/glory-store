const path = require('path')

const magicMatches = (buffer, bytes) => bytes.every((value, index) => buffer[index] === value)

const detectFileType = (buffer = Buffer.alloc(0)) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return ''
  if (magicMatches(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (magicMatches(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf'
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'video/ogg'
  if (buffer.subarray(0, 4).toString('ascii') === '\x1aE\xdf\xa3') return 'video/webm'
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4'
  return ''
}

const fileMatchesAllowedType = (file, allowedTypes) => {
  const detected = detectFileType(file?.buffer)
  return Boolean(detected && allowedTypes.includes(detected) && detected === file?.mimetype)
}

const safeOriginalName = (value = '') => {
  const base = path.basename(String(value || ''))
    .replace(/[\u0000-\u001F<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return base || 'uploaded-file'
}

module.exports = { detectFileType, fileMatchesAllowedType, safeOriginalName }
