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
 * Luxe variant.
 *
 * Dark bottom-heavy gradient overlay, gold/champagne typography,
 * large price display, and a subtle champagne border frame.
 */
export async function render(inputImagePath, outputPath, options) {
  const { width, height, property, fontsDir, brandMark, logoPath } = options

  const title = property.title || property.name || 'Property'
  const price = formatPrice(property.price, property.currency)
  const location = [property.location, property.neighborhood, property.city]
    .filter(Boolean)
    .join(' • ')

  const fontCss = await getFontCss(fontsDir)
  const titleFamily = getFontFamily(title)
  const locationFamily = getFontFamily(location)

  const border = Math.max(16, Math.round(width / 80))
  const pad = Math.round(width * 0.08)
  const overlayHeight = Math.round(height * 0.55)
  const titleFontSize = Math.min(72, Math.round(width / 12))
  const priceFontSize = Math.min(96, Math.round(width / 9))
  const locationFontSize = Math.min(36, Math.round(width / 24))
  const brandFontSize = Math.max(18, Math.round(locationFontSize * 0.75))
  const maxTextWidth = width - pad * 2 - border * 2

  const displayTitle = truncateToWidth(title, maxTextWidth, titleFontSize)
  const displayPrice = truncateToWidth(price, maxTextWidth, priceFontSize)
  const displayLocation = truncateToWidth(location, maxTextWidth, locationFontSize)
  const brandText = logoPath ? '' : escapeXml(brandMark || 'REB')

  const gradientId = 'luxeGradient'
  const svg = buildSvg({
    width,
    height,
    defs: `
      <linearGradient id="${gradientId}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#0a0a0a" stop-opacity="0.92"/>
        <stop offset="45%" stop-color="#0a0a0a" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="#0a0a0a" stop-opacity="0"/>
      </linearGradient>
    `,
    styles: `
      ${fontCss}
      .title { font-family: ${titleFamily}; font-size: ${titleFontSize}px; fill: #f5e6c8; font-weight: 700; }
      .price { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${priceFontSize}px; fill: #d4af37; font-weight: 800; }
      .location { font-family: ${locationFamily}; font-size: ${locationFontSize}px; fill: #e8e8e8; }
      .brand { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${brandFontSize}px; fill: #d4af37; letter-spacing: 3px; font-weight: 600; }
      .frame { fill: none; stroke: #d4af37; stroke-width: ${border / 2}; opacity: 0.85; }
    `,
    body: `
      <rect x="0" y="${height - overlayHeight}" width="${width}" height="${overlayHeight}" fill="url(#${gradientId})"/>
      <rect x="${border}" y="${border}" width="${width - border * 2}" height="${height - border * 2}" rx="${border}" class="frame"/>
      <text x="${pad}" y="${height - overlayHeight + titleFontSize + 40}" class="title">${escapeXml(displayTitle)}</text>
      <text x="${pad}" y="${height - overlayHeight + titleFontSize + priceFontSize + 80}" class="price">${escapeXml(displayPrice)}</text>
      <text x="${pad}" y="${height - overlayHeight + titleFontSize + priceFontSize + locationFontSize + 130}" class="location">${escapeXml(displayLocation)}</text>
      ${brandText ? `<text x="${width - pad}" y="${height - border - 20}" text-anchor="end" class="brand">${brandText}</text>` : ''}
    `,
  })

  const imagePipeline = preprocessImage(sharp, inputImagePath, width, height)
  const overlays = [{ input: Buffer.from(svg, 'utf-8'), blend: 'over' }]

  const logo = await createLogoOverlay(sharp, logoPath, { width, height, pad })
  if (logo) overlays.push(logo)

  return compositeAndSave(sharp, imagePipeline, outputPath, overlays)
}
