import { createProvider as createOpenAiProvider } from './providers/openai.js'
import { createProvider as createGeminiProvider } from './providers/gemini.js'
import { createProvider as createClaudeProvider } from './providers/claude.js'
import { createProvider as createDeepseekProvider } from './providers/deepseek.js'
import { createProvider as createQwenProvider } from './providers/qwen.js'
import { createProvider as createKimiProvider } from './providers/kimi.js'
import {
  safeJsonParse,
  buildExtractionPrompt,
  buildIntentPrompt,
  buildCaptionPrompt,
  buildTemplatePrompt,
  buildHeroSelectionPrompt,
} from './shared.js'

const PROVIDER_FACTORIES = {
  openai: createOpenAiProvider,
  gemini: createGeminiProvider,
  claude: createClaudeProvider,
  deepseek: createDeepseekProvider,
  qwen: createQwenProvider,
  kimi: createKimiProvider,
}

const API_KEY_ENV_VARS = {
  openai: 'WHATSAPP_LISTINGS_OPENAI_API_KEY',
  gemini: 'WHATSAPP_LISTINGS_GEMINI_API_KEY',
  claude: 'WHATSAPP_LISTINGS_CLAUDE_API_KEY',
  deepseek: 'WHATSAPP_LISTINGS_DEEPSEEK_API_KEY',
  qwen: 'WHATSAPP_LISTINGS_QWEN_API_KEY',
  kimi: 'WHATSAPP_LISTINGS_KIMI_API_KEY',
}

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
const CIRCUIT_BREAKER_WINDOW_MS = 60_000
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000

export function createAiAdapter({ config, logger }) {
  const providers = new Map()
  const fallbackChain = Array.from(new Set(config.fallbackAiProviders || []))
  const circuitStates = new Map() // name -> { failures: number[], openUntil: number|null }

  function hasApiKey(name) {
    return Boolean(process.env[API_KEY_ENV_VARS[name]])
  }

  function getProvider(name) {
    if (providers.has(name)) return providers.get(name)
    const key = process.env[API_KEY_ENV_VARS[name]]
    if (!key) {
      logger.warn({ provider: name }, 'AI provider API key missing')
      return null
    }
    const factory = PROVIDER_FACTORIES[name]
    if (!factory) {
      logger.warn({ provider: name }, 'Unknown AI provider')
      return null
    }
    const provider = factory({
      apiKey: key,
      logger: logger.child({ provider: name }),
    })
    providers.set(name, provider)
    return provider
  }

  function isCircuitOpen(name) {
    const state = circuitStates.get(name)
    if (!state) return false
    const now = Date.now()
    if (state.openUntil && state.openUntil > now) {
      return true
    }
    if (state.openUntil && state.openUntil <= now) {
      // Cooldown elapsed; reset.
      circuitStates.set(name, { failures: [], openUntil: null })
      return false
    }
    // Clean old failures outside the window.
    state.failures = state.failures.filter((t) => now - t < CIRCUIT_BREAKER_WINDOW_MS)
    if (state.failures.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      state.openUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS
      logger.warn({ provider: name, openUntil: state.openUntil }, 'AI provider circuit breaker opened')
      return true
    }
    return false
  }

  function recordFailure(name) {
    if (!circuitStates.has(name)) {
      circuitStates.set(name, { failures: [], openUntil: null })
    }
    const state = circuitStates.get(name)
    state.failures.push(Date.now())
  }

  function recordSuccess(name) {
    if (circuitStates.has(name)) {
      const state = circuitStates.get(name)
      if (state.openUntil === null && state.failures.length > 0) {
        state.failures = []
      }
    }
  }

  async function withFallback(methodName, requestedProvider, argsBuilder) {
    const names = []
    if (requestedProvider) names.push(requestedProvider.toLowerCase())
    for (const name of fallbackChain) {
      if (!names.includes(name)) names.push(name)
    }

    const errors = []
    for (const name of names) {
      if (isCircuitOpen(name)) {
        errors.push({ provider: name, error: 'Circuit breaker open' })
        logger.debug({ provider: name, method: methodName }, 'AI provider skipped due to open circuit')
        continue
      }

      const provider = getProvider(name)
      if (!provider) {
        errors.push({ provider: name, error: 'API key missing or unknown provider' })
        continue
      }
      try {
        logger.debug({ provider: name, method: methodName }, 'Trying AI provider')
        const args = argsBuilder()
        const result = await provider[methodName](args)
        recordSuccess(name)
        return { result, provider: name }
      } catch (error) {
        logger.warn(
          { provider: name, method: methodName, error: error.message },
          'AI provider call failed'
        )
        recordFailure(name)
        errors.push({ provider: name, error: error.message })
      }
    }

    throw new Error(
      `All AI providers failed for ${methodName}: ${errors
        .map((e) => `${e.provider} (${e.error})`)
        .join(', ')}`
    )
  }

  function normalizeProperty(parsed) {
    return {
      title: parsed.title || null,
      description: parsed.description || null,
      type: ['sale', 'rent'].includes(parsed.type) ? parsed.type : null,
      property_type: parsed.property_type || null,
      price: typeof parsed.price === 'number' ? parsed.price : null,
      price_unit: parsed.price_unit || null,
      bedrooms: typeof parsed.bedrooms === 'number' ? parsed.bedrooms : null,
      bathrooms: typeof parsed.bathrooms === 'number' ? parsed.bathrooms : null,
      area: typeof parsed.area === 'number' ? parsed.area : null,
      area_unit: parsed.area_unit || null,
      location: parsed.location || null,
      city: parsed.city || null,
      neighborhood: parsed.neighborhood || null,
      address: parsed.address || null,
      amenities: Array.isArray(parsed.amenities) ? parsed.amenities : [],
      furnished: typeof parsed.furnished === 'boolean' ? parsed.furnished : null,
      features: Array.isArray(parsed.features) ? parsed.features : [],
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
    }
  }

  function normalizeIntent(parsed) {
    return {
      intent: ['create', 'update'].includes(parsed.intent) ? parsed.intent : 'create',
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0,
      matched_listing_id: parsed.matched_listing_id || null,
      matched_address: parsed.matched_address || null,
      reason: parsed.reason || '',
    }
  }

  function normalizeCaption(parsed, platform) {
    let caption = parsed.caption || ''
    let hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : []

    if (platform === 'x') {
      if (hashtags.length > 1) hashtags = hashtags.slice(0, 1)
      if (caption.length > 280) caption = caption.slice(0, 277) + '...'
    } else if (platform === 'instagram' || platform === 'tiktok') {
      if (hashtags.length > 5) hashtags = hashtags.slice(0, 5)
    }

    return { caption, hashtags }
  }

  function normalizeTemplate(parsed) {
    const variant = ['luxe', 'modern', 'urgent'].includes(parsed.variant)
      ? parsed.variant
      : 'modern'
    return { variant, reason: parsed.reason || '' }
  }

  async function extractProperty({ messages, images, provider, locationPin, hasPin, intent = 'create', existingListing = null } = {}) {
    const prompt = buildExtractionPrompt(messages, { locationPin, hasPin, intent, existingListing })
    const { result, provider: usedProvider } = await withFallback(
      'extractProperty',
      provider || config.aiProvider,
      () => ({ messages, images, prompt, locationPin, hasPin, intent, existingListing })
    )
    const parsed = safeJsonParse(result.text)
    return {
      property: normalizeProperty(parsed),
      changeSummary: normalizeChangeSummary(parsed?.change_summary),
      provider: usedProvider,
      raw: { provider: usedProvider, response: result.raw, parsed },
    }
  }

  function normalizeChangeSummary(summary) {
    if (!summary || typeof summary !== 'object') return null
    return {
      price_changed: summary.price_changed || null,
      title_changed: summary.title_changed || null,
      description_changed: summary.description_changed || null,
      status_changed: summary.status_changed || null,
      photos_added: typeof summary.photos_added === 'number' ? summary.photos_added : 0,
      location_changed: Boolean(summary.location_changed),
      other_changes: Array.isArray(summary.other_changes) ? summary.other_changes : [],
    }
  }

  async function classifyIntent({ messages, images, provider } = {}) {
    const prompt = buildIntentPrompt(messages)
    const { result, provider: usedProvider } = await withFallback(
      'classifyIntent',
      provider || config.aiProvider,
      () => ({ messages, images, prompt })
    )
    const parsed = safeJsonParse(result.text)
    return {
      ...normalizeIntent(parsed),
      raw: { provider: usedProvider, response: result.raw, parsed },
    }
  }

  async function generateCaption({ platform, property, variant, provider } = {}) {
    const prompt = buildCaptionPrompt(platform, property, variant)
    const { result, provider: usedProvider } = await withFallback(
      'generateCaption',
      provider || config.aiProvider,
      () => ({ platform, property, variant, prompt })
    )
    const parsed = safeJsonParse(result.text)
    return {
      ...normalizeCaption(parsed, platform),
      raw: { provider: usedProvider, response: result.raw, parsed },
    }
  }

  async function selectBestTemplate({ imageDescriptions, provider } = {}) {
    const prompt = buildTemplatePrompt(imageDescriptions)
    const { result, provider: usedProvider } = await withFallback(
      'selectBestTemplate',
      provider || config.aiProvider,
      () => ({ imageDescriptions, prompt })
    )
    const parsed = safeJsonParse(result.text)
    return {
      ...normalizeTemplate(parsed),
      raw: { provider: usedProvider, response: result.raw, parsed },
    }
  }

  async function selectHeroImage({ images, provider } = {}) {
    const prompt = buildHeroSelectionPrompt(images?.length || 0)
    const { result, provider: usedProvider } = await withFallback(
      'selectHeroImage',
      provider || config.aiProvider,
      () => ({ images, prompt })
    )
    const parsed = safeJsonParse(result.text)
    const index = Number.isInteger(parsed?.index) ? parsed.index : 0
    return {
      index: Math.max(0, Math.min(images?.length - 1 || 0, index)),
      reason: parsed?.reason || '',
      raw: { provider: usedProvider, response: result.raw, parsed },
    }
  }

  /**
   * Generic one-sentence generation used by other modules (e.g. Market Pricing).
   * Provider is expected to return JSON containing { sentence: "..." }.
   */
  async function generateMarketContextSentence({ prompt, provider } = {}) {
    const { result, provider: usedProvider } = await withFallback(
      'generateCaption',
      provider || config.aiProvider,
      () => ({ platform: 'instagram', property: {}, variant: 'modern', prompt })
    )
    const parsed = safeJsonParse(result.text)
    return {
      sentence: parsed?.sentence || parsed?.caption || String(result.text || '').slice(0, 300),
      provider: usedProvider,
      raw: { provider: usedProvider, response: result.raw, parsed },
    }
  }

  async function healthCheck(provider) {
    const name = (provider || config.aiProvider || 'gemini').toLowerCase()
    const p = getProvider(name)
    if (!p) {
      return {
        ok: false,
        provider: name,
        error: 'Provider not configured or API key missing',
      }
    }
    const result = await p.healthCheck()
    return { ...result, provider: name }
  }

  return {
    extractProperty,
    classifyIntent,
    generateCaption,
    selectBestTemplate,
    selectHeroImage,
    generateMarketContextSentence,
    healthCheck,
    // Exposed for tests and diagnostics only.
    providers,
    circuitStates,
  }
}
