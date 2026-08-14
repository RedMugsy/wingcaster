/**
 * Shared utilities for AI providers.
 *
 * Handles JSON sanitisation, image-to-base64 fetching, prompt building, and
 * request timeouts. All helpers are provider-agnostic so they can be reused
 * by every adapter in this directory.
 */

import { promises as dns } from 'node:dns'
import ipaddr from 'ipaddr.js'
import sharp from 'sharp'
import { Agent } from 'undici'

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal'])
const FORMAT_TO_MIME = {
  avif: 'image/avif', gif: 'image/gif', heif: 'image/heif', jpeg: 'image/jpeg',
  jp2: 'image/jp2', jxl: 'image/jxl', png: 'image/png', tiff: 'image/tiff', webp: 'image/webp',
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name] || fallback)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function isBlockedAddress(address) {
  let parsed
  try { parsed = ipaddr.parse(address) } catch { return true }
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address()
  if (parsed.kind() === 'ipv4') {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
    ].some(([network, prefix]) => parsed.match(ipaddr.parse(network), prefix))
  }
  return parsed.match(ipaddr.parse('::1'), 128)
    || parsed.match(ipaddr.parse('fe80::'), 10)
    || parsed.match(ipaddr.parse('fc00::'), 7)
}

async function assertPublicDestination(target) {
  const hostname = target.hostname.toLowerCase().replace(/\.$/, '')
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new Error('Image URL resolves to a blocked network address')
  if (ipaddr.isValid(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error('Image URL resolves to a blocked network address')
    return [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
  }
  const addresses = await dns.lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Image URL resolves to a blocked network address')
  }
  return addresses
}

function pinnedDispatcher(addresses) {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const eligible = options?.family
          ? addresses.filter(({ family }) => family === options.family)
          : addresses
        if (!eligible.length) return callback(new Error('No validated address matches the requested family'))
        if (options?.all) return callback(null, eligible)
        callback(null, eligible[0].address, eligible[0].family)
      },
    },
  })
}

async function validateImage(buffer) {
  let metadata
  try { metadata = await sharp(buffer).metadata() } catch { throw new Error('Image payload is not a valid image') }
  const mimeType = FORMAT_TO_MIME[metadata.format]
  if (!mimeType) throw new Error('Image payload is not a valid image')
  return mimeType
}

function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Image fetch timed out'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('Image fetch timed out'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function rejectResponse(response, message) {
  void response.body?.cancel().catch(() => {})
  throw new Error(message)
}

async function readLimitedBody(response, declaredLength, maxBytes, controller) {
  if (!response.body) throw new Error('Image response has no body')
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes || received > declaredLength) {
        controller.abort()
        throw new Error('Image response exceeds its declared or configured size limit')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (received !== declaredLength) throw new Error('Image response length does not match Content-Length')
  return Buffer.concat(chunks, received)
}

/**
 * Fetch a validated public image URL and return its bytes as base64.
 */
export async function fetchImageAsBase64(url, _providedMimeType) {
  if (!url) throw new Error('Image URL is required')
  if (typeof url !== 'string') throw new Error('Only http(s) or data: image URLs are accepted')
  const maxBytes = positiveIntegerEnv('IMAGE_FETCH_MAX_BYTES', 15_728_640)

  if (url.toLowerCase().startsWith('data:')) {
    const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
    if (!match) throw new Error('Invalid data URI')
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
    if (!buffer.length) throw new Error('Invalid data URI')
    if (buffer.length > maxBytes) throw new Error(`Image payload exceeds ${maxBytes} bytes`)
    await validateImage(buffer)
    return { mimeType: match[1].toLowerCase(), data: buffer.toString('base64') }
  }

  let target
  try { target = new URL(url) } catch { throw new Error('Only http(s) or data: image URLs are accepted') }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Only http(s) or data: image URLs are accepted')
  }
  if (target.username || target.password) throw new Error('Image URLs must not contain credentials')

  const timeoutMs = positiveIntegerEnv('IMAGE_FETCH_TIMEOUT_MS', 15_000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const addresses = await withAbort(assertPublicDestination(target), controller.signal)
      const dispatcher = pinnedDispatcher(addresses)
      try {
        const response = await fetch(target, {
          redirect: 'manual',
          credentials: 'omit',
          dispatcher,
          headers: { 'User-Agent': 'Wingcaster/1.0 (+ingest)' },
          signal: controller.signal,
        })
        if (response.status >= 300 && response.status < 400) {
          if (redirects === 3) throw new Error('Image URL exceeded maximum redirects')
          const location = response.headers.get('location')
          if (!location) throw new Error('Image redirect is missing Location header')
          await response.body?.cancel()
          target = new URL(location, target)
          if (!['http:', 'https:'].includes(target.protocol)) {
            throw new Error('Only http(s) or data: image URLs are accepted')
          }
          if (target.username || target.password) throw new Error('Image URLs must not contain credentials')
          continue
        }
        if (!response.ok) await rejectResponse(response, `Failed to fetch image ${target}: ${response.status}`)
        const contentLengthHeader = response.headers.get('content-length')
        if (!contentLengthHeader || !/^\d+$/.test(contentLengthHeader)) {
          await rejectResponse(response, 'Image response must include a valid Content-Length')
        }
        const declaredLength = Number(contentLengthHeader)
        if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
          await rejectResponse(response, `Image response exceeds ${maxBytes} bytes`)
        }
        const contentType = response.headers.get('content-type')
        if (!contentType || !contentType.toLowerCase().startsWith('image/')) {
          await rejectResponse(response, 'Image response Content-Type must be image/*')
        }
        const buffer = await readLimitedBody(response, declaredLength, maxBytes, controller)
        const mimeType = await validateImage(buffer)
        return { mimeType, data: buffer.toString('base64') }
      } finally {
        await dispatcher.close()
      }
    }
    throw new Error('Image URL exceeded maximum redirects')
  } finally {
    clearTimeout(timeout)
  }
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
