import { Collections } from '../infrastructure/db.js'
import { createScraperProvider } from './scraper-providers.js'
import { createHash } from 'node:crypto'

/**
 * Scraper orchestration for external comparables.
 *
 * Providers live in scraper-providers.js and are selected by the
 * pricing_sources.provider column. Every provider is defensive:
 * it logs, respects rate limits, and returns an empty array on failure.
 */

const DEFAULT_SCRAPER_CONFIG = {
  max_requests_per_minute: 10,
  max_pages_per_run: 3,
  retry_attempts: 2,
  request_timeout_ms: 30000,
}

export function createScraperService({ dal, aiAdapter, currencyService, config, logger }) {
  const providerRegistry = new Map()
  registerProvider('manual', createScraperProvider({ name: 'manual' }))
  registerProvider('skeleton', createScraperProvider({ name: 'manual' }))
  registerProvider('olx_lebanon', createScraperProvider({ name: 'olx_lebanon' }))
  registerProvider('property_finder_lb', createScraperProvider({ name: 'property_finder_lb' }))
  registerProvider('government_records', createScraperProvider({ name: 'government_records' }))
  registerProvider('ai', createScraperProvider({ name: 'ai', aiAdapter, currencyService }))

  function registerProvider(name, provider) {
    providerRegistry.set(name, provider)
  }

  async function runScrapers(areaId, propertyType) {
    let areas = []
    if (areaId) {
      const area = await dal.findOne('area_profiles', (a) => a.id === areaId)
      if (!area) throw new Error('Area not found')
      areas = [area]
    } else {
      areas = await dal.findAll('area_profiles', () => true)
    }

    const enabledSources = await dal.findAll(Collections.PRICING_SOURCES, (s) => s.enabled === true && s.is_internal === false)
    const results = []

    for (const area of areas) {
      for (const source of enabledSources) {
        let provider = providerRegistry.get(source.provider)
        if (!provider) {
          // Allow provider name to match source slug for flexibility.
          provider = providerRegistry.get(source.source)
        }
        if (!provider) {
          logger.warn({ source: source.source, provider: source.provider }, 'No scraper provider registered')
          continue
        }

        try {
          const scraperConfig = { ...DEFAULT_SCRAPER_CONFIG, ...(source.config_json || {}) }
          const listings = await provider.fetchListings({
            area,
            propertyType,
            config: scraperConfig,
            logger: logger.child({ source: source.source }),
          })
          for (const listing of listings) {
            await upsertExternalComparable({
              ...listing,
              source: source.source,
              area_id: area.id,
              currency: listing.currency || config.baseCurrency,
            })
          }
          results.push({ area: area.slug, source: source.source, fetched: listings.length })
        } catch (err) {
          logger.error({ err: err.message, source: source.source, area: area.slug }, 'Scraper run failed')
          results.push({ area: area.slug, source: source.source, fetched: 0, error: err.message })
        }
      }
    }

    return results
  }

  async function upsertExternalComparable(listing) {
    const source = canonicalSlug(listing.source || 'unknown')
    const externalId = listing.external_id ? String(listing.external_id).trim() : null
    const contentHash = externalId ? null : comparableContentHash({ ...listing, source })
    const existing = await dal.findOne(
      Collections.EXTERNAL_COMPARABLES,
      (ec) => ec.source === source && (externalId ? ec.external_id === externalId : ec.content_hash === contentHash)
    )
    const now = new Date().toISOString()
    const item = {
      ...listing,
      id: existing?.id || crypto.randomUUID(),
      source,
      external_id: externalId,
      content_hash: contentHash,
      currency: String(listing.currency || config.baseCurrency).toUpperCase(),
      property_type: canonicalSlug(listing.property_type || 'apartment'),
      location_text: listing.location_text ? String(listing.location_text).trim() : null,
      updated_at: now,
      last_seen_at: now,
      data: listing.data || {},
    }
    if (existing) {
      await dal.update(Collections.EXTERNAL_COMPARABLES, (ec) => ec.id === existing.id, () => item)
      return item
    } else {
      item.created_at = now
      return dal.insert(Collections.EXTERNAL_COMPARABLES, item)
    }
  }

  async function listSources() {
    return dal.findAll(Collections.PRICING_SOURCES, () => true)
  }

  async function updateSource(sourceKey, payload) {
    let updatedRecord = null
    await dal.update(
      Collections.PRICING_SOURCES,
      (s) => s.source === sourceKey,
      (s) => {
        updatedRecord = {
          ...s,
          ...payload,
          config_json: payload.config_json ? { ...s.config_json, ...payload.config_json } : s.config_json,
          updated_at: new Date().toISOString(),
          data: { ...s.data, ...(payload.data || {}) },
        }
        return updatedRecord
      }
    )
    return updatedRecord
  }

  async function createSource(payload) {
    const now = new Date().toISOString()
    return dal.insert(Collections.PRICING_SOURCES, {
      id: crypto.randomUUID(),
      ...payload,
      config_json: payload.config_json || {},
      created_at: now,
      updated_at: now,
      data: payload.data || {},
    })
  }

  async function deleteSource(sourceKey) {
    return dal.remove(Collections.PRICING_SOURCES, (s) => s.source === sourceKey)
  }

  return {
    registerProvider,
    runScrapers,
    upsertExternalComparable,
    listSources,
    updateSource,
    createSource,
    deleteSource,
  }
}

function canonicalSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function comparableContentHash(listing) {
  const identity = [
    listing.source,
    listing.source_url,
    String(listing.title || '').trim().toLowerCase(),
    Number(listing.price) || 0,
    String(listing.currency || '').toUpperCase(),
    canonicalSlug(listing.property_type),
    Number(listing.bedrooms) || 0,
    Number(listing.bathrooms) || 0,
    Number(listing.area_sqm) || 0,
    String(listing.location_text || '').trim().toLowerCase(),
    listing.scraped_at ? String(listing.scraped_at).slice(0, 10) : '',
  ].join('|')
  return createHash('sha256').update(identity).digest('hex')
}
