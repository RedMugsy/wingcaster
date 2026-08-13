import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAiAdapter } from '../infrastructure/ai/adapter.js'

describe('WhatsApp Listing AI adapter', () => {
  const envBackup = {}

  beforeEach(() => {
    // Preserve env vars that tests may override.
    for (const key of [
      'WHATSAPP_LISTINGS_OPENAI_API_KEY',
      'WHATSAPP_LISTINGS_GEMINI_API_KEY',
      'WHATSAPP_LISTINGS_CLAUDE_API_KEY',
      'WHATSAPP_LISTINGS_DEEPSEEK_API_KEY',
      'WHATSAPP_LISTINGS_QWEN_API_KEY',
      'WHATSAPP_LISTINGS_KIMI_API_KEY',
    ]) {
      envBackup[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of Object.keys(envBackup)) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key]
      else delete process.env[key]
    }
    vi.restoreAllMocks()
  })

  it('falls back to the next configured provider when the first fails', async () => {
    process.env.WHATSAPP_LISTINGS_GEMINI_API_KEY = 'gemini-key'
    process.env.WHATSAPP_LISTINGS_OPENAI_API_KEY = 'openai-key'

    const adapter = createAiAdapter({
      config: { aiProvider: 'gemini', fallbackAiProviders: ['openai'] },
      logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() })) },
    })

    // Stub the provider factories by directly replacing the provider map after creation.
    const failingProvider = {
      extractProperty: vi.fn().mockRejectedValue(new Error('Gemini down')),
      classifyIntent: vi.fn(),
      generateCaption: vi.fn(),
      selectBestTemplate: vi.fn(),
      selectHeroImage: vi.fn(),
      healthCheck: vi.fn(),
    }
    const successProvider = {
      extractProperty: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          title: 'Test Villa',
          description: 'A nice villa',
          type: 'sale',
          property_type: 'villa',
          price: 500000,
          price_unit: 'USD',
          bedrooms: 3,
          bathrooms: 2,
          area: 200,
          area_unit: 'sqm',
          location: 'Beirut',
          city: 'Beirut',
          neighborhood: 'Ashrafieh',
          address: null,
          amenities: [],
          furnished: false,
          features: [],
          confidence: 0.9,
        }),
        raw: {},
      }),
      classifyIntent: vi.fn(),
      generateCaption: vi.fn(),
      selectBestTemplate: vi.fn(),
      selectHeroImage: vi.fn(),
      healthCheck: vi.fn(),
    }

    adapter.providers.set('gemini', failingProvider)
    adapter.providers.set('openai', successProvider)

    const result = await adapter.extractProperty({ messages: [{ text: 'villa for sale' }], images: [], provider: 'gemini' })

    expect(failingProvider.extractProperty).toHaveBeenCalled()
    expect(successProvider.extractProperty).toHaveBeenCalled()
    expect(result.property.title).toBe('Test Villa')
    expect(result.provider).toBe('openai')
  })

  it('opens a circuit breaker after repeated failures', async () => {
    process.env.WHATSAPP_LISTINGS_GEMINI_API_KEY = 'gemini-key'
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() })) }
    const adapter = createAiAdapter({
      config: { aiProvider: 'gemini', fallbackAiProviders: [] },
      logger,
    })

    const failingProvider = {
      extractProperty: vi.fn().mockRejectedValue(new Error('always fails')),
      classifyIntent: vi.fn(),
      generateCaption: vi.fn(),
      selectBestTemplate: vi.fn(),
      selectHeroImage: vi.fn(),
      healthCheck: vi.fn(),
    }
    adapter.providers.set('gemini', failingProvider)

    for (let i = 0; i < 6; i++) {
      try {
        await adapter.extractProperty({ messages: [{ text: 'villa' }], images: [] })
      } catch {}
    }

    // After enough failures, the circuit should be open and the provider skipped entirely.
    failingProvider.extractProperty.mockClear()
    await expect(adapter.extractProperty({ messages: [{ text: 'villa' }], images: [] })).rejects.toThrow()
    expect(failingProvider.extractProperty).not.toHaveBeenCalled()
  })
})
