/**
 * SVG rendering pipeline for JSON templates.
 *
 * Consumes:
 *   - a validated + platform-resolved template (from schema.resolveTemplateForPlatform)
 *   - a binding context (from data-binding.buildBindingContext)
 *   - a photo fetcher for photo layers (async, returns base64 data URI)
 *
 * Emits: a fully self-contained SVG string with every image inlined as
 * base64. No external dependencies at render time — the SVG can be handed
 * to sharp() immediately for PNG rasterisation.
 */

import { evaluateCondition, interpolate, resolvePath } from './data-binding.js'
import { escapeXml } from './shared.js'

/**
 * Render a resolved template into an SVG string.
 *
 * @param {object} template  — output of resolveTemplateForPlatform (has resolved_canvas + resolved_layers)
 * @param {object} ctx       — binding context (listing, agent, brand, ...)
 * @param {function} fetchPhoto — async fn taking a URL/path and returning a data URI (or null on failure)
 */
export async function renderTemplateToSvg(template, ctx, fetchPhoto) {
  const canvas = template.resolved_canvas
  const layers = template.resolved_layers || []

  // Pre-fetch every photo layer's data URI in parallel so the SVG assembly
  // is fully synchronous below.
  const photoLayers = layers.filter((l) => l.type === 'photo' && evaluateCondition(l.show_if, ctx))
  const dataUris = new Map()
  await Promise.all(photoLayers.map(async (l) => {
    const url = interpolate(l.bind, ctx) || resolvePath(String(l.bind || '').replace(/[{}]/g, '').trim(), ctx)
    const uri = url ? await fetchPhoto(url) : null
    if (uri) dataUris.set(l.id, uri)
  }))

  const layerSvg = layers.map((layer) => {
    if (!evaluateCondition(layer.show_if, ctx)) return ''
    switch (layer.type) {
      case 'photo':  return renderPhoto(layer, dataUris.get(layer.id))
      case 'text':   return renderText(layer, ctx)
      case 'rect':   return renderRect(layer)
      case 'line':   return renderLine(layer)
      case 'icon':   return renderIcon(layer)
      case 'badge':  return renderBadge(layer, ctx)
      case 'group':  return renderGroup(layer, ctx, dataUris)
      default:       return ''
    }
  }).join('\n  ')

  const bg = template.background || {}
  const bgFill = bg.color ? `<rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${escapeXml(bg.color)}"/>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
  ${bgFill}
  ${layerSvg}
</svg>`
}

/* -------------------------------- Renderers ------------------------------ */

function renderPhoto(layer, dataUri) {
  const clipId = `clip_${layer.id}`
  const fit = layer.fit || 'cover'
  const preserveAspect = fit === 'contain' ? 'xMidYMid meet' : fit === 'fill' ? 'none' : 'xMidYMid slice'
  const rx = layer.radius ? ` rx="${layer.radius}" ry="${layer.radius}"` : ''
  const placeholder = dataUri
    ? `<image href="${escapeXml(dataUri)}" x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" preserveAspectRatio="${preserveAspect}"/>`
    : `<rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" fill="#E5E5E5"${rx}/>`
  return `<defs><clipPath id="${clipId}"><rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}"${rx}/></clipPath></defs>
  <g clip-path="url(#${clipId})">${placeholder}</g>`
}

function renderText(layer, ctx) {
  const text = interpolate(String(layer.bind || ''), ctx)
  if (!text || !String(text).trim()) return ''
  const font = escapeXml(layer.font || "'Helvetica Neue', 'Arial', sans-serif")
  const size = layer.size || 32
  const weight = layer.weight || 400
  const color = escapeXml(layer.color || '#111')
  const italic = layer.italic ? ' font-style="italic"' : ''
  const anchor = layer.align === 'right' ? 'end' : layer.align === 'center' ? 'middle' : 'start'
  const letterSpacing = layer.letter_spacing ? ` letter-spacing="${layer.letter_spacing}"` : ''
  const opacity = layer.opacity != null ? ` opacity="${layer.opacity}"` : ''
  const style = layer.stroke_color
    ? ` style="paint-order:stroke;stroke:${escapeXml(layer.stroke_color)};stroke-width:${layer.stroke_width || 2};"`
    : ''
  // Word-wrap: split on \n and render one <tspan> per line with dy.
  const lines = String(text).split(/\r?\n/)
  const tspans = lines.map((ln, i) => {
    const dy = i === 0 ? 0 : (layer.line_height || 1.2) * size
    return `<tspan x="${layer.x}" dy="${dy}">${escapeXml(ln)}</tspan>`
  }).join('')
  return `<text x="${layer.x}" y="${layer.y}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${color}"${italic}${letterSpacing}${opacity}${style}>${tspans}</text>`
}

function renderRect(layer) {
  const fill = escapeXml(layer.color || 'transparent')
  const stroke = layer.border_color ? ` stroke="${escapeXml(layer.border_color)}" stroke-width="${layer.border_width || 1}"` : ''
  const rx = layer.radius ? ` rx="${layer.radius}" ry="${layer.radius}"` : ''
  const opacity = layer.opacity != null ? ` opacity="${layer.opacity}"` : ''
  return `<rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" fill="${fill}"${stroke}${rx}${opacity}/>`
}

function renderLine(layer) {
  const stroke = escapeXml(layer.color || '#000')
  return `<line x1="${layer.x}" y1="${layer.y}" x2="${layer.x2}" y2="${layer.y2}" stroke="${stroke}" stroke-width="${layer.weight || 1}"/>`
}

function renderBadge(layer, ctx) {
  const text = interpolate(String(layer.bind || ''), ctx)
  if (!text) return ''
  const bg = escapeXml(layer.bg_color || '#EAB308')
  const fg = escapeXml(layer.text_color || '#0F0F0F')
  const radius = layer.radius != null ? layer.radius : layer.h / 2
  const size = layer.size || Math.round(layer.h * 0.5)
  const font = escapeXml(layer.font || "'Helvetica Neue', 'Arial', sans-serif")
  const weight = layer.weight || 800
  return `<rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" rx="${radius}" ry="${radius}" fill="${bg}"/>
  <text x="${layer.x + layer.w / 2}" y="${layer.y + layer.h / 2 + size * 0.35}" text-anchor="middle" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fg}" letter-spacing="0.12em">${escapeXml(String(text).toUpperCase())}</text>`
}

function renderIcon(layer) {
  // Geometric primitives — no external font. Each icon fits inside a
  // (size x size) bounding box originating at (layer.x, layer.y).
  const c = escapeXml(layer.color || '#3A3A3A')
  const s = layer.size || 32
  const w = layer.weight || 2
  const g = (path) => `<g transform="translate(${layer.x} ${layer.y})">${path}</g>`
  switch (layer.icon) {
    case 'bed':   return g(`<path d="M2 ${s*0.55} h${s} v${s*0.20} h-${s} z M${s*0.10} ${s*0.55} v-${s*0.15} h${s*0.50} v${s*0.15}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`)
    case 'bath':  return g(`<path d="M2 ${s*0.60} h${s} v${s*0.05} q0 ${s*0.20} -${s*0.20} ${s*0.20} h-${s*0.60} q-${s*0.20} 0 -${s*0.20} -${s*0.20} z M${s*0.20} ${s*0.35} v${s*0.25}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`)
    case 'area':  return g(`<rect x="2" y="${s*0.20}" width="${s*0.75}" height="${s*0.65}" fill="none" stroke="${c}" stroke-width="${w}"/>`)
    case 'pin':   return g(`<path d="M${s*0.50} ${s*0.90} q-${s*0.35} -${s*0.30} -${s*0.35} -${s*0.55} q0 -${s*0.20} ${s*0.35} -${s*0.20} q${s*0.35} 0 ${s*0.35} ${s*0.20} q0 ${s*0.25} -${s*0.35} ${s*0.55} z M${s*0.50} ${s*0.32} q-${s*0.08} 0 -${s*0.08} ${s*0.08} q0 ${s*0.08} ${s*0.08} ${s*0.08} q${s*0.08} 0 ${s*0.08} -${s*0.08} q0 -${s*0.08} -${s*0.08} -${s*0.08}" fill="${c}"/>`)
    case 'phone': return g(`<path d="M${s*0.15} ${s*0.20} q0 -${s*0.05} ${s*0.05} -${s*0.05} h${s*0.15} q${s*0.05} 0 ${s*0.06} ${s*0.05} l${s*0.03} ${s*0.12} q${s*0.01} ${s*0.03} -${s*0.02} ${s*0.05} l-${s*0.08} ${s*0.05} q${s*0.10} ${s*0.20} ${s*0.30} ${s*0.30} l${s*0.05} -${s*0.08} q${s*0.02} -${s*0.03} ${s*0.05} -${s*0.02} l${s*0.12} ${s*0.03} q${s*0.05} ${s*0.01} ${s*0.05} ${s*0.06} v${s*0.15} q0 ${s*0.05} -${s*0.05} ${s*0.05} q-${s*0.55} 0 -${s*0.65} -${s*0.65} z" fill="${c}"/>`)
    case 'mail':  return g(`<rect x="${s*0.10}" y="${s*0.28}" width="${s*0.80}" height="${s*0.55}" fill="none" stroke="${c}" stroke-width="${w}"/><path d="M${s*0.10} ${s*0.28} l${s*0.40} ${s*0.28} l${s*0.40} -${s*0.28}" fill="none" stroke="${c}" stroke-width="${w}"/>`)
    case 'star':  return g(`<path d="M${s*0.50} ${s*0.10} l${s*0.12} ${s*0.24} l${s*0.28} ${s*0.04} l-${s*0.20} ${s*0.20} l${s*0.05} ${s*0.28} l-${s*0.25} -${s*0.14} l-${s*0.25} ${s*0.14} l${s*0.05} -${s*0.28} l-${s*0.20} -${s*0.20} l${s*0.28} -${s*0.04} z" fill="${c}"/>`)
    case 'flame': return g(`<path d="M${s*0.50} ${s*0.10} q-${s*0.30} ${s*0.20} -${s*0.30} ${s*0.45} q0 ${s*0.30} ${s*0.30} ${s*0.30} q${s*0.30} 0 ${s*0.30} -${s*0.30} q0 -${s*0.20} -${s*0.20} -${s*0.35} q0 ${s*0.10} -${s*0.10} ${s*0.10} q-${s*0.05} 0 -${s*0.05} -${s*0.10} q0 -${s*0.10} ${s*0.05} -${s*0.20} q-${s*0.05} ${s*0.05} -${s*0.05} ${s*0.10} z" fill="${c}"/>`)
    case 'clock': return g(`<circle cx="${s*0.50}" cy="${s*0.50}" r="${s*0.40}" fill="none" stroke="${c}" stroke-width="${w}"/><path d="M${s*0.50} ${s*0.25} v${s*0.25} l${s*0.15} ${s*0.10}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`)
    default:      return ''
  }
}

function renderGroup(layer, ctx, dataUris) {
  if (!Array.isArray(layer.children)) return ''
  const inner = layer.children.map((child) => {
    if (!evaluateCondition(child.show_if, ctx)) return ''
    // Children coords are already resolved (parent group's x/y is added
    // via translate — the SVG transform below).
    switch (child.type) {
      case 'photo':  return renderPhoto(child, dataUris.get(child.id))
      case 'text':   return renderText(child, ctx)
      case 'rect':   return renderRect(child)
      case 'line':   return renderLine(child)
      case 'icon':   return renderIcon(child)
      case 'badge':  return renderBadge(child, ctx)
      default:       return ''
    }
  }).join('')
  return `<g transform="translate(${layer.x} ${layer.y})">${inner}</g>`
}
