/**
 * Rendering pipeline for the built-in engine.
 *
 * template + listing → resolved layers per platform → SVG → PNG (sharp).
 *
 * Fetches the hero photo (and any other bound photo layer) as base64 so
 * the SVG passed to sharp is fully self-contained (no network access
 * during rasterisation, deterministic output).
 */

import sharp from 'sharp'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { PLATFORM_DIMENSIONS, isValidPlatformKey } from './dimensions.js'
import { resolveTemplateForPlatform } from './schema.js'
import { buildBindingContext } from './data-binding.js'
import { renderTemplateToSvg } from './template-engine.js'

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif',  '.webp': 'image/webp',
}

async function fetchImageAsDataUri(url) {
  if (!url) return null
  if (url.startsWith('data:')) return url

  if (/^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const ct = res.headers.get('content-type') || 'image/jpeg'
      const buf = Buffer.from(await res.arrayBuffer())
      return `data:${ct};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  const backendRoot = resolve(process.cwd())
  const candidates = [
    url.startsWith('/') ? join(backendRoot, url) : join(backendRoot, 'uploads', url),
    url.startsWith('/') ? join(backendRoot, '..', 'backend', url) : join(backendRoot, '..', 'backend', 'uploads', url),
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        const buf = await readFile(c)
        const mime = MIME_BY_EXT[extname(c).toLowerCase()] || 'image/jpeg'
        return `data:${mime};base64,${buf.toString('base64')}`
      } catch { /* try next */ }
    }
  }
  return null
}

async function ensureListingDir(listingId, storageRoot) {
  const dir = join(storageRoot, listingId)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Render a single (template, platform) combo. Returns the persisted asset
 * metadata + relative public URL under /uploads/social-cards/.
 */
export async function renderSocialCard({ template, listing, agent, brand, distribution, platform, storageRoot, publicBaseUrl = '/uploads/social-cards' }) {
  if (!template) throw Object.assign(new Error('template is required'), { code: 'MISSING_TEMPLATE' })
  if (!isValidPlatformKey(platform)) throw Object.assign(new Error(`Unknown platform: ${platform}`), { code: 'BAD_PLATFORM' })

  const dimensions = { ...PLATFORM_DIMENSIONS[platform], __key: platform }
  const resolved = resolveTemplateForPlatform(template, dimensions)
  const ctx = buildBindingContext({ listing, agent, brand, distribution })

  const svg = await renderTemplateToSvg(resolved, ctx, fetchImageAsDataUri)
  const pngBuffer = await sharp(Buffer.from(svg), { density: 144 })
    .resize({ width: resolved.resolved_canvas.width, height: resolved.resolved_canvas.height, fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()

  const id = uuidv4()
  const filename = `${template.id}_${platform}_${id.slice(0, 8)}.png`
  const dir = await ensureListingDir(listing.id, storageRoot)
  const absPath = join(dir, filename)
  await writeFile(absPath, pngBuffer)

  return {
    id,
    listing_id: listing.id,
    template_id: template.id,
    template_name: template.name,
    template_engine: template.engine || 'builtin',
    platform,
    platform_label: dimensions.label,
    dimensions: { width: resolved.resolved_canvas.width, height: resolved.resolved_canvas.height, aspect: dimensions.aspect },
    filename,
    path: absPath,
    url: `${publicBaseUrl}/${listing.id}/${filename}`,
    size_bytes: pngBuffer.length,
    created_at: new Date().toISOString(),
  }
}

/**
 * Render a template across many platforms in parallel. Per-platform failures
 * are returned as `{error, platform}` entries so successes still land.
 */
export async function renderSocialCardMatrix({ template, listing, agent, brand, distribution, platforms, storageRoot, publicBaseUrl }) {
  const results = await Promise.all(platforms.map(async (platform) => {
    try {
      return { ok: true, asset: await renderSocialCard({ template, listing, agent, brand, distribution, platform, storageRoot, publicBaseUrl }) }
    } catch (err) {
      return { ok: false, template_id: template.id, platform, error: err.message || String(err) }
    }
  }))
  const assets = results.filter((r) => r.ok).map((r) => r.asset)
  const errors = results.filter((r) => !r.ok).map((r) => ({ template_id: r.template_id, platform: r.platform, error: r.error }))
  return { assets, errors }
}
