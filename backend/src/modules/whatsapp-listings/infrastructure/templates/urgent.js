import sharp from 'sharp'
import {
  buildSvg,
  getFontCss,
  escapeXml,
  formatPrice,
  getFontFamily,
  truncateToWidth,
  preprocessImage,
  createLogoOverlay,
  compositeAndSave,
} from './utils.js'

/**
 * Urgent variant.
 *
 * Red/amber accent bar at the top, a "NEW LISTING" or "UPDATE" badge,
 * bold condensed price, and a slight vignette over the hero image.
 */
export async function render(inputImagePath, outputPath, options) {
  const { width, height, property, fontsDir, brandMark, logoPath } = options

  const title = property.title || property.name || 'Property'
  const price = formatPrice(property.price, property.currency)
  const location = [property.location, property.neighborhood, property.city]
    .filter(Boolean)
    .join(' • ')
  const intent = property.intent || 'create'
  const badge = intent === 'update' ? 'UPDATE' : 'NEW LISTING'

  const fontCss = await getFontCss(fontsDir)
  const titleFamily = getFontFamily(title)
  const locationFamily = getFontFamily(location)

  const pad = Math.round(width * 0.08)
  const barHeight = Math.max(72, Math.round(height * 0.08))
  const badgeFontSize = Math.round(barHeight * 0.55)
  const titleFontSize = Math.min(64, Math.round(width / 13))
  const priceFontSize = Math.min(88, Math.round(width / 10))
  const locationFontSize = Math.min(36, Math.round(width / 24))
  const brandFontSize = Math.max(18, Math.round(locationFontSize * 0.8))
  const maxTextWidth = width - pad * 2

  const displayTitle = truncateToWidth(title, maxTextWidth, titleFontSize)
  const displayLocation = truncateToWidth(location, maxTextWidth, locationFontSize)
  const brandText = logoPath ? '' : escapeXml(brandMark || 'REB')

  const gradientId = 'urgentVignette'
  const svg = buildSvg({
    width,
    height,
    defs: `
      <radialGradient id="${gradientId}" cx="50%" cy="50%" r="75%" fx="50%" fy="50%">
        <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
      </radialGradient>
    `,
    styles: `
      ${fontCss}
      .topBar { fill: #e63946; }
      .badge { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${badgeFontSize}px; fill: #ffffff; font-weight: 800; letter-spacing: 4px; }
      .title { font-family: ${titleFamily}; font-size: ${titleFontSize}px; fill: #ffffff; font-weight: 700; }
      .price { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${priceFontSize}px; fill: #ffcc00; font-weight: 800; }
      .location { font-family: ${locationFamily}; font-size: ${locationFontSize}px; fill: #eeeeee; }
      .brand { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${brandFontSize}px; fill: #ffffff; font-weight: 600; opacity: 0.8; }
    `,
    body: `
      <rect x="0" y="0" width="${width}" height="${barHeight}" class="topBar"/>
      <text x="${pad}" y="${Math.round(barHeight * 0.72)}" class="badge">${escapeXml(badge)}</text>
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})"/>
      <text x="${pad}" y="${height - 220}" class="title">${escapeXml(displayTitle)}</text>
      <text x="${pad}" y="${height - 220 + titleFontSize + priceFontSize + 10}" class="price">${escapeXml(price)}</text>
      <text x="${pad}" y="${height - 220 + titleFontSize + priceFontSize + locationFontSize + 50}" class="location">${escapeXml(displayLocation)}</text>
      ${brandText ? `<text x="${width - pad}" y="${height - 30}" text-anchor="end" class="brand">${brandText}</text>` : ''}
    `,
  })

  const imagePipeline = preprocessImage(sharp, inputImagePath, width, height)
  const overlays = [{ input: Buffer.from(svg, 'utf-8'), blend: 'over' }]

  const logo = await createLogoOverlay(sharp, logoPath, { width, height, pad })
  if (logo) overlays.push(logo)

  return compositeAndSave(sharp, imagePipeline, outputPath, overlays)
}
