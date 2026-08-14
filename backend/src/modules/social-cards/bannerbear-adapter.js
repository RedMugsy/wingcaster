/**
 * Bannerbear adapter — premium template lane.
 *
 * Bannerbear (https://bannerbear.com) is a programmatic image generation
 * API purpose-built for exactly this use case: templates designed in
 * their web editor, rendered on-demand with per-request modifications
 * (image URLs + text overlays + colors). We use it as a second engine
 * behind the same SocialCardStudio picker — tenant selects a template
 * tagged { engine: 'bannerbear' } and the render endpoint dispatches
 * here instead of the built-in SVG pipeline.
 *
 * Ownership model:
 *   Enterprise (default): platform-wide BANNERBEAR_API_KEY holds a single
 *   Bannerbear project. Imported templates land as owner_type='store'
 *   with engine='bannerbear'.
 *
 *   Per-tenant (future): a tenant can supply their own Bannerbear key
 *   via Settings → Channels; their templates land as owner_type='agency'
 *   with engine='bannerbear'.
 *
 * Render mode:
 *   Sync-first. Bannerbear supports `?force_synchronous=true` on paid
 *   tiers which returns the rendered image in the same request (~5-15s
 *   typical). We use that here. If Bannerbear returns pending (rare on
 *   sync mode), we poll GET /images/:uid every 2s up to 30s. Webhook
 *   receiver is scaffolded for later async-only use cases.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { formatPrice } from './shared.js'
import { buildBindingContext, interpolate, resolvePath } from './data-binding.js'
import { PLATFORM_DIMENSIONS } from './dimensions.js'

const API_BASE = 'https://api.bannerbear.com/v2'
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30_000

export function getBannerbearConfig() {
  const key = process.env.BANNERBEAR_API_KEY || ''
  return {
    enabled: Boolean(key),
    apiKey: key,
    projectApiKey: process.env.BANNERBEAR_PROJECT_API_KEY || key,
    forceSynchronous: process.env.BANNERBEAR_FORCE_SYNCHRONOUS !== 'false',
    webhookUrl: process.env.BANNERBEAR_WEBHOOK_URL || null, // used only in async mode
  }
}

export function isBannerbearEnabled() {
  return Boolean(process.env.BANNERBEAR_API_KEY)
}

/**
 * Fetch the tenant/project template catalog from Bannerbear.
 * Returns a normalized list — each entry we then upsert into social_card_templates.
 *
 * The mapping between Bannerbear modification names and our binding paths
 * is heuristic (see mapModificationsToBindings). Users can override the
 * mapping per template via the template editor.
 */
export async function fetchBannerbearTemplates(apiKey) {
  const key = apiKey || getBannerbearConfig().apiKey
  if (!key) throw Object.assign(new Error('BANNERBEAR_API_KEY missing'), { code: 'MISSING_KEY' })

  const res = await fetch(`${API_BASE}/templates`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw Object.assign(new Error(`Bannerbear /templates failed (${res.status}): ${data?.message || 'unknown'}`), {
      code: `BB_TEMPLATES_${res.status}`, details: data,
    })
  }
  const arr = Array.isArray(data) ? data : (data?.templates || [])
  return arr.map(normalizeBannerbearTemplate)
}

/**
 * Fetch a single template's full modifications schema so the mapping UI
 * can render every editable field.
 */
export async function fetchBannerbearTemplateDetail(uid, apiKey) {
  const key = apiKey || getBannerbearConfig().apiKey
  if (!key) throw Object.assign(new Error('BANNERBEAR_API_KEY missing'), { code: 'MISSING_KEY' })
  const res = await fetch(`${API_BASE}/templates/${uid}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw Object.assign(new Error(`Bannerbear /templates/${uid} failed (${res.status}): ${data?.message || 'unknown'}`), {
      code: `BB_TEMPLATE_${res.status}`, details: data,
    })
  }
  return normalizeBannerbearTemplate(data)
}

/**
 * Convert one Bannerbear template payload into our internal shape so it
 * round-trips through the same list / duplicate / edit endpoints as the
 * built-in templates.
 */
function normalizeBannerbearTemplate(bb) {
  const width = bb.width || 1080
  const height = bb.height || 1080
  const modifications = Array.isArray(bb.available_modifications) ? bb.available_modifications : []
  const bindings = mapModificationsToBindings(modifications)

  return {
    id: `bannerbear_${bb.uid}`,
    schema_version: 1,
    name: bb.name || 'Bannerbear template',
    description: bb.description || `Bannerbear template ${bb.uid}`,
    owner_type: 'store',
    owner_id: null,
    engine: 'bannerbear',
    category: bb.tags?.[0] || 'bannerbear',
    tags: bb.tags || [],
    base_canvas: { width, height },
    background: bb.background_color ? { color: bb.background_color } : {},
    // Layers array is intentionally sparse — the built-in renderer never
    // consumes a bannerbear template, but keeping a minimal layers array
    // lets the SocialCardStudio card preview render (photo + name).
    layers: [
      { id: 'bb_preview', type: 'photo', bind: 'listing.photos[0]', x: 0, y: 0, w: width, h: height, fit: 'cover' },
    ],
    bannerbear: {
      uid: bb.uid,
      preview_url: bb.preview_url || null,
      available_modifications: modifications,
      bindings,
    },
  }
}

/**
 * Best-effort heuristic mapping from a Bannerbear modification name to
 * one of our binding paths. Names Bannerbear designers commonly use in
 * real-estate templates are matched first; the rest fall through to
 * empty (agent maps them manually in the template editor).
 */
function mapModificationsToBindings(mods) {
  const bindings = {}
  for (const m of mods) {
    const name = String(m.name || '').toLowerCase()
    if (m.image_url !== undefined || name.match(/(image|photo|hero|cover|picture|pic|shot)/)) {
      if (name.includes('agent')) bindings[m.name] = { type: 'image', bind: 'agent.photo' }
      else if (name.includes('logo')) bindings[m.name] = { type: 'image', bind: 'brand.logo_url' }
      else bindings[m.name] = { type: 'image', bind: 'listing.photos[0]' }
      continue
    }
    if (name.match(/(price|amount|value|cost)/)) {
      bindings[m.name] = { type: 'text', bind: '{{formatPrice listing.price listing.price_unit}}' }
      continue
    }
    if (name.match(/(title|headline|name(?!.*agent))/)) {
      bindings[m.name] = { type: 'text', bind: '{{listing.title}}' }
      continue
    }
    if (name.match(/(location|address|city|neighborhood|area)/) && !name.includes('sqm') && !name.includes('sqft')) {
      bindings[m.name] = { type: 'text', bind: '{{coalesce listing.neighborhood listing.city listing.location}}' }
      continue
    }
    if (name.match(/(bed|bedroom)/)) {
      bindings[m.name] = { type: 'text', bind: '{{listing.bedrooms}} bd' }
      continue
    }
    if (name.match(/(bath|bathroom)/)) {
      bindings[m.name] = { type: 'text', bind: '{{listing.bathrooms}} ba' }
      continue
    }
    if (name.match(/(area|sqm|sqft|size)/)) {
      bindings[m.name] = { type: 'text', bind: '{{formatArea listing.area listing.area_unit}}' }
      continue
    }
    if (name.match(/agent.*name|realtor/)) {
      bindings[m.name] = { type: 'text', bind: '{{agent.name}}' }
      continue
    }
    if (name.match(/agency/)) {
      bindings[m.name] = { type: 'text', bind: '{{agent.agency_name}}' }
      continue
    }
    if (name.match(/(brand|company)/)) {
      bindings[m.name] = { type: 'text', bind: '{{brand.name}}' }
      continue
    }
    if (name.match(/phone|tel|mobile/)) {
      bindings[m.name] = { type: 'text', bind: '{{agent.phone}}' }
      continue
    }
    if (name.match(/email/)) {
      bindings[m.name] = { type: 'text', bind: '{{agent.email}}' }
      continue
    }
    if (name.match(/(status|badge)/)) {
      bindings[m.name] = { type: 'text', bind: '{{status listing.status}}' }
      continue
    }
    // Unknown — leave unmapped. Renderer will send an empty modification
    // so Bannerbear falls back to whatever default it has for the field.
    bindings[m.name] = { type: 'text', bind: '' }
  }
  return bindings
}

/**
 * Build the modifications payload for a Bannerbear render call, resolving
 * each binding against the listing + agent + brand context.
 */
function buildModifications(template, ctx) {
  const bindings = template.bannerbear?.bindings || {}
  const out = []
  for (const [name, binding] of Object.entries(bindings)) {
    if (!binding || !binding.bind) continue
    if (binding.type === 'image') {
      const url = resolvePath(binding.bind.replace(/[{}]/g, '').trim(), ctx)
      if (url) out.push({ name, image_url: String(url) })
    } else {
      const value = interpolate(binding.bind, ctx)
      if (value != null && String(value).trim() !== '') {
        out.push({ name, text: String(value) })
      }
    }
  }
  return out
}

/**
 * Render a single Bannerbear template. Returns the persisted asset in the
 * same shape as the built-in renderer's output so the endpoint layer can
 * treat both engines uniformly.
 */
export async function renderBannerbearCard({ template, listing, agent, brand, distribution, platform, storageRoot, publicBaseUrl = '/uploads/social-cards' }) {
  const cfg = getBannerbearConfig()
  if (!cfg.apiKey) throw Object.assign(new Error('Bannerbear is not configured — set BANNERBEAR_API_KEY'), { code: 'BB_NOT_CONFIGURED' })
  const uid = template.bannerbear?.uid
  if (!uid) throw Object.assign(new Error('Template is not a Bannerbear template (missing bannerbear.uid)'), { code: 'BB_BAD_TEMPLATE' })

  const dimensions = { ...PLATFORM_DIMENSIONS[platform], __key: platform }
  const ctx = buildBindingContext({ listing, agent, brand, distribution })
  const modifications = buildModifications(template, ctx)

  // Bannerbear doesn't accept a per-request canvas — the template's own
  // dimensions win. We still record the platform + dimensions we intended
  // so the UI can label the asset consistently.
  const body = {
    template: uid,
    modifications,
    metadata: JSON.stringify({ listing_id: listing.id, platform, agent_id: listing.agent_id }),
  }
  if (!cfg.forceSynchronous && cfg.webhookUrl) body.webhook_url = cfg.webhookUrl

  const url = `${API_BASE}/images${cfg.forceSynchronous ? '?force_synchronous=true' : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw Object.assign(new Error(`Bannerbear render failed (${res.status}): ${data?.message || 'unknown'}`), {
      code: `BB_RENDER_${res.status}`, details: data,
    })
  }

  const finalImage = data?.image_url || (data?.status === 'completed' ? data?.image_url : null)
  const bbUid = data?.uid || null
  let imageUrl = finalImage
  if (!imageUrl && bbUid) {
    // Poll for completion (async fallback).
    imageUrl = await pollForImage(bbUid, cfg.apiKey)
  }
  if (!imageUrl) {
    throw Object.assign(new Error('Bannerbear did not return an image_url (sync + poll both empty)'), { code: 'BB_NO_IMAGE' })
  }

  // Download the rendered image and persist it locally so the tenant's
  // published post never depends on Bannerbear CDN availability.
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) {
    throw Object.assign(new Error(`Download from Bannerbear CDN failed (${imgRes.status})`), { code: 'BB_DOWNLOAD_FAILED' })
  }
  const buf = Buffer.from(await imgRes.arrayBuffer())

  const id = uuidv4()
  const filename = `${template.id}_${platform}_${id.slice(0, 8)}.png`
  const dir = join(storageRoot, listing.id)
  await mkdir(dir, { recursive: true })
  const absPath = join(dir, filename)
  await writeFile(absPath, buf)

  return {
    id,
    listing_id: listing.id,
    template_id: template.id,
    template_name: template.name,
    template_engine: 'bannerbear',
    platform,
    platform_label: dimensions.label,
    dimensions: { width: dimensions.width, height: dimensions.height, aspect: dimensions.aspect },
    filename,
    path: absPath,
    url: `${publicBaseUrl}/${listing.id}/${filename}`,
    size_bytes: buf.length,
    created_at: new Date().toISOString(),
    provider: 'bannerbear',
    bannerbear_uid: bbUid,
  }
}

async function pollForImage(bbUid, apiKey) {
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch(`${API_BASE}/images/${bbUid}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) continue
    if (data?.status === 'completed' && data?.image_url) return data.image_url
    if (data?.status === 'failed') throw Object.assign(new Error(`Bannerbear render failed: ${data?.message || 'unknown'}`), { code: 'BB_FAILED' })
  }
  return null
}

/**
 * Parse a Bannerbear webhook payload. Bannerbear posts JSON with the
 * completed image details when `webhook_url` was supplied at render time.
 * Returns a normalised event for the caller to persist / attach to a
 * pending social_cards row.
 */
export function parseBannerbearWebhook(payload) {
  if (!payload || typeof payload !== 'object') return null
  const metadata = safeJsonParse(payload.metadata) || {}
  return {
    provider: 'bannerbear',
    bannerbear_uid: payload.uid,
    status: payload.status,
    image_url: payload.image_url,
    template_uid: payload.template,
    metadata,
    received_at: new Date().toISOString(),
  }
}

function safeJsonParse(input) {
  if (!input) return null
  try { return typeof input === 'string' ? JSON.parse(input) : input } catch { return null }
}

// Ensure the utility exports stay tree-shakeable if the module is only
// used for template import (no rendering).
export { formatPrice }
