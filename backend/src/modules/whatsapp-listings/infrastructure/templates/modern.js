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
 * Modern variant.
 *
 * Rounded-corner window mask, clean white/light-grey lower-third bar,
 * bold sans-serif type, and a prominent location line.
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

  const border = Math.max(20, Math.round(width / 60))
  const radius = Math.max(24, Math.round(width / 40))
  const pad = Math.round(width * 0.08)
  const barHeight = Math.round(height * 0.28)
  const titleFontSize = Math.min(56, Math.round(width / 14))
  const priceFontSize = Math.min(64, Math.round(width / 12))
  const locationFontSize = Math.min(40, Math.round(width / 22))
  const brandFontSize = Math.max(18, Math.round(locationFontSize * 0.75))
  const maxTextWidth = width - pad * 2 - border * 2

  const displayTitle = truncateToWidth(title, maxTextWidth, titleFontSize)
  const displayLocation = truncateToWidth(location, maxTextWidth, locationFontSize)
  const brandText = logoPath ? '' : escapeXml(brandMark || 'REB')

  const svg = buildSvg({
    width,
    height,
    defs: `
      <mask id="roundedMask">
        <rect width="${width}" height="${height}" fill="white"/>
        <rect x="${border}" y="${border}" width="${width - border * 2}" height="${height - border * 2}" rx="${radius}" ry="${radius}" fill="black"/>
      </mask>
    `,
    styles: `
      ${fontCss}
      .frame { fill: none; stroke: #ffffff; stroke-width: ${border / 2}; }
      .bar { fill: #ffffff; }
      .title { font-family: ${titleFamily}; font-size: ${titleFontSize}px; fill: #1a1a1a; font-weight: 700; }
      .price { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${priceFontSize}px; fill: #0f5bff; font-weight: 800; }
      .location { font-family: ${locationFamily}; font-size: ${locationFontSize}px; fill: #555555; }
      .brand { font-family: NotoSans, NotoSansArabic, sans-serif; font-size: ${brandFontSize}px; fill: #888888; font-weight: 600; }
    `,
    body: `
      <rect width="${width}" height="${height}" fill="white" mask="url(#roundedMask)"/>
      <rect x="${border}" y="${border}" width="${width - border * 2}" height="${height - border * 2}" rx="${radius}" ry="${radius}" class="frame"/>
      <rect x="${border}" y="${height - barHeight - border / 2}" width="${width - border * 2}" height="${barHeight}" rx="${radius / 2}" ry="${radius / 2}" class="bar"/>
      <text x="${pad}" y="${height - barHeight + titleFontSize + 24}" class="title">${escapeXml(displayTitle)}</text>
      <text x="${pad}" y="${height - barHeight + titleFontSize + priceFontSize + 50}" class="price">${escapeXml(price)}</text>
      <text x="${pad}" y="${height - barHeight + titleFontSize + priceFontSize + locationFontSize + 90}" class="location">${escapeXml(displayLocation)}</text>
      ${brandText ? `<text x="${width - pad}" y="${height - 22}" text-anchor="end" class="brand">${brandText}</text>` : ''}
    `,
  })

  const imagePipeline = preprocessImage(sharp, inputImagePath, width, height)
  const overlays = [{ input: Buffer.from(svg, 'utf-8'), blend: 'over' }]

  const logo = await createLogoOverlay(sharp, logoPath, { width, height, pad })
  if (logo) overlays.push(logo)

  return compositeAndSave(sharp, imagePipeline, outputPath, overlays)
}
