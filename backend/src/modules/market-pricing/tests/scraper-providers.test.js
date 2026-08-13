import { describe, it, expect, vi } from 'vitest'
import { createScraperProvider } from '../application/scraper-providers.js'

const logger = { debug: () => {}, warn: () => {}, info: () => {}, child: () => logger }

describe('Scraper Providers', () => {
  it('manual provider returns empty array', async () => {
    const provider = createScraperProvider({ name: 'manual' })
    const result = await provider.fetchListings({ area: { slug: 'batroun' }, propertyType: 'apartment', config: {}, logger })
    expect(result).toEqual([])
  })

  it('ai provider returns empty array when no adapter available', async () => {
    const provider = createScraperProvider({ name: 'ai' })
    const result = await provider.fetchListings({ area: { slug: 'batroun', name: 'Batroun' }, propertyType: 'apartment', config: {}, logger })
    expect(result).toEqual([])
  })

  it('ai provider generates synthetic comparables', async () => {
    const aiAdapter = {
      generateMarketContextSentence: vi.fn().mockResolvedValue({
        result: JSON.stringify({
          listings: [
            {
              title: '2BR apartment in Batroun',
              price: 250000,
              currency: 'USD',
              property_type: 'apartment',
              bedrooms: 2,
              bathrooms: 2,
              area_sqm: 120,
              location_text: 'Batroun',
              condition: 'good',
              furnished: 'unfurnished',
              view_type: 'city_view',
              payment_method: 'cash',
            },
          ],
        }),
      }),
    }

    const provider = createScraperProvider({ name: 'ai', aiAdapter })
    const result = await provider.fetchListings({
      area: { slug: 'batroun', name: 'Batroun' },
      propertyType: 'apartment',
      config: { synthetic_count: 1 },
      logger,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      source: 'ai_estimated',
      title: '2BR apartment in Batroun',
      price: 250000,
      property_type: 'apartment',
    })
    expect(result[0].external_id).toContain('ai-batroun-apartment-0')
  })

  it('ai provider recovers from malformed JSON response', async () => {
    const aiAdapter = {
      generateMarketContextSentence: vi.fn().mockResolvedValue({
        result: 'Here is the JSON:\n{"listings": [{"title": "Test", "price": 100000, "currency": "USD", "property_type": "apartment"}]}',
      }),
    }

    const provider = createScraperProvider({ name: 'ai', aiAdapter })
    const result = await provider.fetchListings({
      area: { slug: 'batroun', name: 'Batroun' },
      propertyType: 'apartment',
      config: {},
      logger,
    })

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Test')
  })

  it('ai provider handles adapter errors gracefully', async () => {
    const aiAdapter = {
      generateMarketContextSentence: vi.fn().mockRejectedValue(new Error('AI service unavailable')),
    }

    const provider = createScraperProvider({ name: 'ai', aiAdapter })
    const result = await provider.fetchListings({
      area: { slug: 'batroun', name: 'Batroun' },
      propertyType: 'apartment',
      config: {},
      logger,
    })

    expect(result).toEqual([])
  })

  it('olx lebanon skeleton provider returns empty on fetch failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const provider = createScraperProvider({ name: 'olx_lebanon' })
    const result = await provider.fetchListings({
      area: { slug: 'batroun', name: 'Batroun' },
      propertyType: 'apartment',
      config: { max_pages_per_run: 1, max_listings_per_run: 1, request_delay_ms: 0 },
      logger,
    })

    expect(result).toEqual([])
  })
})
