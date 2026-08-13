import { readFile } from 'fs/promises'
import { join } from 'path'

const FONT_FILES = {
  notoSans: 'NotoSans-Regular.ttf',
  notoArabic: 'NotoSansArabic-Regular.ttf',
}

let fontCache = null

/**
 * Read the self-hosted fonts and return base64 data URIs for embedding
 * inside SVG @font-face declarations.
 *
 * If a font file is missing, its value is `null` and callers should fall
 * back to system fonts.
 */
export async function getFontFaces(fontsDir) {
  if (fontCache) return fontCache

  const faces = {}
  for (const [key, file] of Object.entries(FONT_FILES)) {
    try {
      const buf = await readFile(join(fontsDir, file))
      faces[key] = `data:font/ttf;base64,${buf.toString('base64')}`
    } catch {
      faces[key] = null
    }
  }

  fontCache = faces
  return faces
}

/**
 * Build the SVG style block that embeds the self-hosted fonts and declares
 * a default text font-family stack.
 */
export async function getFontCss(fontsDir) {
  const faces = await getFontFaces(fontsDir)
  const lines = []

  if (faces.notoSans) {
    lines.push(`@font-face { font-family: 'NotoSans'; src: url('${faces.notoSans}'); }`)
  }
  if (faces.notoArabic) {
    lines.push(`@font-face { font-family: 'NotoSansArabic'; src: url('${faces.notoArabic}'); }`)
  }

  lines.push(`text { font-family: NotoSans, NotoSansArabic, 'DejaVu Sans', Arial, sans-serif; }`)
  return lines.join('\n')
}

/**
 * Build a complete SVG document string.
 */
export function buildSvg({ width, height, defs = '', styles = '', body = '' }) {
  const ns = 'http://www.w3.org/2000/svg'
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${ns}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${defs}</defs>
  <style>${styles}</style>
  ${body}
</svg>`
}

/**
 * Escape text for safe SVG use.
 */
export function escapeXml(text) {
  if (text === null || text === undefined) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Detect whether the text contains Arabic/RTL characters.
 */
export function detectRtl(text) {
  if (!text) return false
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(text))
}

/**
 * Choose the preferred font-family stack for a piece of text.
 */
export function getFontFamily(text) {
  return detectRtl(text)
    ? 'NotoSansArabic, NotoSans, sans-serif'
    : 'NotoSans, NotoSansArabic, sans-serif'
}

/**
 * Format a numeric price with a currency symbol.
 */
export function formatPrice(price, currency = 'USD') {
  if (price === null || price === undefined || price === '') return ''

  const numeric = Number(String(price).replace(/[^0-9.]/g, ''))
  if (Number.isNaN(numeric)) return String(price)

  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    AED: 'AED ',
    QAR: 'QAR ',
    SAR: 'SAR ',
    LBP: 'LBP ',
  }

  const symbol = symbols[currency] ?? `${currency} `
  const formatted = numeric.toLocaleString('en-US')
  return `${symbol}${formatted}`
}

/**
 * Very rough text-width estimation. We do not have a real text-shaping
 * library, so this is based on average glyph width and is used only for
 * truncation and layout decisions.
 */
export function estimateTextWidth(text, fontSize) {
  if (!text) return 0
  const avgWidth = detectRtl(text) ? 0.55 : 0.6
  return String(text).length * fontSize * avgWidth
}

/**
 * Truncate text with an ellipsis if it exceeds the available width.
 */
export function truncateToWidth(text, maxWidth, fontSize) {
  if (!text) return ''
  let str = String(text).trim()
  if (estimateTextWidth(str, fontSize) <= maxWidth) return str

  while (str.length > 3 && estimateTextWidth(str + '…', fontSize) > maxWidth) {
    str = str.slice(0, -1).trim()
  }
  return str + '…'
}

/**
 * Wrap text into lines by word, capping at `maxLines`.
 */
export function wrapLines(text, maxWidth, fontSize, maxLines = 2) {
  if (!text) return []
  const words = String(text).trim().split(/\s+/)
  const lines = []
  let current = ''

  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (estimateTextWidth(test, fontSize) <= maxWidth) {
      current = test
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)

  return lines.slice(0, maxLines).map((line, index) => {
    if (index === maxLines - 1 && lines.length > maxLines) {
      return truncateToWidth(line, maxWidth, fontSize)
    }
    return line
  })
}

/**
 * Common image pre-processing for all variants: resize/crop to the target
 * canvas with a centre crop, then JPEG encode.
 */
export function preprocessImage(sharp, inputImagePath, width, height) {
  return sharp(inputImagePath)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 92, progressive: true })
}

/**
 * Create a logo composite overlay if a logo path is provided.
 * The logo is resized to fit within a small portion of the canvas and
 * placed in the bottom-right corner.
 */
export async function createLogoOverlay(sharp, logoPath, { width, height, pad }) {
  if (!logoPath) return null

  const maxHeight = Math.max(40, Math.round(height * 0.06))
  const meta = await sharp(logoPath).metadata()
  const logoHeight = maxHeight
  const logoWidth = Math.round((meta.width / meta.height) * logoHeight)

  const resized = await sharp(logoPath)
    .resize(logoWidth, logoHeight, { fit: 'inside' })
    .png()
    .toBuffer()

  return {
    input: resized,
    blend: 'over',
    top: height - logoHeight - pad,
    left: width - logoWidth - pad,
  }
}

/**
 * Composite a list of overlays onto a prepared sharp pipeline and save it.
 */
export async function compositeAndSave(sharp, imagePipeline, outputPath, overlays) {
  await imagePipeline.composite(overlays).toFile(outputPath)
  return outputPath
}
