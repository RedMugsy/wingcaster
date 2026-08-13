/**
 * Shared utilities for AI providers.
 *
 * Handles JSON sanitisation, image-to-base64 fetching, prompt building, and
 * request timeouts. All helpers are provider-agnostic so they can be reused
 * by every adapter in this directory.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname } from 'node:path'

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

function guessMimeType(url, providedMimeType) {
  if (providedMimeType) return providedMimeType
  const cleanUrl = (url || '').split('?')[0]
  const ext = extname(cleanUrl).toLowerCase()
  return EXT_TO_MIME[ext] || 'image/jpeg'
}

/**
 * Fetch an image URL/path and return a base64 payload plus its MIME type.
 * Supports remote http(s) URLs, file:// URLs, and local filesystem paths.
 */
export async function fetchImageAsBase64(url, providedMimeType) {
  if (!url) throw new Error('Image URL is required')

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new Error('Invalid data URI')
    return { mimeType: match[1], data: match[2] }
  }

  if (url.startsWith('file://')) {
    const path = fileURLToPath(url)
    const buffer = await readFile(path)
    return { mimeType: guessMimeType(path, providedMimeType), data: buffer.toString('base64') }
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const buffer = await readFile(url)
    return { mimeType: guessMimeType(url, providedMimeType), data: buffer.toString('base64') }
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`)
  const buffer = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') || guessMimeType(url, providedMimeType)
  return { mimeType: contentType, data: Buffer.from(buffer).toString('base64') }
}

export function createTimeoutSignal(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

export function cleanJsonResponse(text) {
  if (!text) return ''
  let cleaned = String(text).trim()

  // Strip leading ```json / ``` fences and trailing ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '')
    cleaned = cleaned.replace(/\s*```$/, '')
  }

  return cleaned.trim()
}

function extractJson(text) {
  let start = -1
  let depth = 0
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{' || ch === '[') {
      if (start === -1) start = i
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

export function safeJsonParse(text) {
  const cleaned = cleanJsonResponse(text)
  try {
    return JSON.parse(cleaned)
  } catch (err) {
    const extracted = extractJson(cleaned)
    if (extracted) {
      try {
        return JSON.parse(extracted)
      } catch {}
    }
    throw new Error(`Failed to parse JSON response: ${err.message}`)
  }
}

function buildMessagesText(messages) {
  if (!messages || !messages.length) return '(no messages)'
  return messages
    .map((m, i) => {
      const type = m.type ? ` [${m.type}]` : ''
      return `${i + 1}. ${m.role || 'user'}${type}: ${m.text || '(no text)'}`
    })
    .join('\n')
}

export function buildExtractionPrompt(messages, { locationPin, hasPin, intent = 'create', existingListing = null } = {}) {
  let locationInstruction = ''
  if (hasPin && locationPin) {
    locationInstruction = `The agent has provided a verified location pin at latitude ${locationPin.latitude}, longitude ${locationPin.longitude}.
You do NOT need to infer location from their text. Extract only: price, bedrooms, bathrooms, property type, description, amenities.
Ignore any address references in the text. If a name or label was included with the pin ("${locationPin.name || locationPin.address || ''}"), you may mention it in the description or features, but do not treat it as a structured address.`
  } else {
    locationInstruction = `The agent has NOT provided a location pin.
Extract location information from their text if present, but flag confidence as LOW for any location fields.
After extraction, the agent will be prompted to share a location pin for accuracy.`
  }

  let updateInstruction = ''
  let changeSummaryShape = ''
  if (intent === 'update' && existingListing) {
    updateInstruction = `The agent wants to UPDATE an existing listing. Compare the new content to the existing listing below and output a change_summary describing what changed.`
    changeSummaryShape = `  "change_summary": {
    "price_changed": { "from": number|null, "to": number|null },
    "title_changed": { "from": "string|null", "to": "string|null" },
    "description_changed": { "from": "string|null", "to": "string|null" },
    "status_changed": { "from": "string|null", "to": "string|null" },
    "photos_added": number,
    "location_changed": true|false,
    "other_changes": ["array of strings"]
  },`
  }

  return `You are a real-estate listing extraction assistant for a WhatsApp intake bot.
Analyze the conversation and extract property details into a JSON object.
Return ONLY a JSON object, no markdown fences, no explanation.

${locationInstruction}
${updateInstruction}

Required JSON shape:
{
  "title": "string or null",
  "description": "string or null",
  "type": "sale" or "rent" or null,
  "property_type": "apartment" or "villa" or "land" or "office" or "shop" or "building" or "warehouse" or "studio" or null,
  "price": number or null,
  "price_unit": "USD" or "AED" or "SAR" or "LYD" or "EGP" or "month" or "year" or null,
  "bedrooms": number or null,
  "bathrooms": number or null,
  "area": number or null,
  "area_unit": "sqm" or "sqft" or "m2" or "ft2" or null,
  "location": "string or null",
  "city": "string or null",
  "neighborhood": "string or null",
  "address": "string or null",
  "amenities": ["array of strings"],
  "furnished": true or false or null,
  "features": ["array of strings"],
  "confidence": number between 0 and 1${changeSummaryShape ? ',\n' + changeSummaryShape : ''}
}

Use null for missing values, [] for missing arrays. Infer currency and unit where possible.
${existingListing ? `\nExisting listing being updated:\n${JSON.stringify(existingListing, null, 2)}\n` : ''}
Conversation:
${buildMessagesText(messages)}`
}

export function buildIntentPrompt(messages) {
  return `You are an intent classifier for a WhatsApp real-estate listing bot.
Analyze the conversation and classify the user's intent into JSON.
Return ONLY a JSON object, no markdown fences, no explanation.

Required JSON shape:
{
  "intent": "create" or "update",
  "confidence": number between 0 and 1,
  "matched_listing_id": "string or null",
  "matched_address": "string or null",
  "reason": "string"
}

- "create" means the user wants to list a new property.
- "update" means the user wants to update an existing listing.
- "matched_listing_id" is an explicit ID the user mentions (e.g., "update listing #123").
- "matched_address" is an address that matches an existing listing.

Conversation:
${buildMessagesText(messages)}`
}

export function buildCaptionPrompt(platform, property, variant) {
  const platformRules = {
    instagram:
      'Instagram caption: emoji-rich, use a 3-line hook, include a call-to-action, max 5 hashtags. Return hashtags in a separate array.',
    tiktok:
      'TikTok caption / video script: hook-first, casual, include a trending-sound placeholder, max 5 hashtags. Return hashtags in a separate array.',
    x: 'X (Twitter) caption: under 280 characters, punchy, max one hashtag. Return hashtags in a separate array.',
  }

  return `You are a social media caption writer for real estate.
${platformRules[platform] || platformRules.instagram}

Return ONLY a JSON object, no markdown fences, no explanation:
{
  "caption": "string",
  "hashtags": ["array of strings"]
}

Platform: ${platform}
Template variant (tone): ${variant || 'modern'}
Property details:
${JSON.stringify(property, null, 2)}`
}

export function buildHeroSelectionPrompt(imageCount) {
  return `You are a real-estate listing photographer. Choose the best hero image index for a property listing from ${imageCount} submitted images.
Pick the clearest, most appealing, well-lit exterior or living-room shot. Avoid blurry, dark, or cluttered photos.
Return ONLY a JSON object, no markdown fences, no explanation:
{
  "index": number (0-based),
  "reason": "string"
}`
}

export function buildTemplatePrompt(imageDescriptions) {
  return `You are a real-estate marketing designer. Choose the best thumbnail template variant for a listing based on these image descriptions.

Available variants:
- "luxe": elegant, premium, gold/dark tones, high-end properties
- "modern": clean, minimal, bright, contemporary properties
- "urgent": bold, red/orange, limited-time, distressed-sale, auction-style

Return ONLY a JSON object, no markdown fences, no explanation:
{
  "variant": "luxe" or "modern" or "urgent",
  "reason": "string"
}

Image descriptions:
${(imageDescriptions || []).map((d, i) => `${i + 1}. ${d}`).join('\n') || '(none provided)'}`
}
