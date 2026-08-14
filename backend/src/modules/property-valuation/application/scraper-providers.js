/**
 * Respectful web-scraping providers for external comparables.
 *
 * Principles:
 * - Rotate user agents and throttle requests.
 * - Obey per-source rate limits from pricing_sources.config_json.
 * - Never throw unhandled errors; return empty arrays on failure.
 * - Attribute every listing to its source and source_url.
 *
 * Each provider implements:
 *   async fetchListings({ area, propertyType, config, logger }) -> Listing[]
 */

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

function pickUserAgent() {
  return DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)]
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchHtml(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000)
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': pickUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Referer: options.referer || new URL(url).origin,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    return await res.text()
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

function extractJsonLd(text) {
  const results = []
  const regex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1])
      results.push(json)
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return results
}

function sanitizeNumber(value) {
  if (value == null) return null
  const num = Number(String(value).replace(/[^0-9.]/g, ''))
  return Number.isFinite(num) && num > 0 ? num : null
}

function createManualProvider() {
  return {
    name: 'manual',
    async fetchListings() {
      return []
    },
  }
}

/**
 * Skeleton provider that documents the contract. Subclasses should override
 * buildSearchUrl and parseListingPage.
 */
function createRespectfulHtmlProvider({
  name,
  baseUrl,
  buildSearchUrl,
  parseListingPage,
  defaultMaxPages = 1,
  defaultMaxListings = 20,
}) {
  return {
    name,
    async fetchListings({ area, propertyType, config, logger }) {
      const maxPages = config?.max_pages_per_run ?? defaultMaxPages
      const maxListings = config?.max_listings_per_run ?? defaultMaxListings
      const delayMs = config?.request_delay_ms ?? 2000
      const timeoutMs = config?.request_timeout_ms ?? 15000

      const url = buildSearchUrl({ area, propertyType, config })
      if (!url) {
        logger.debug({ provider: name, area: area?.slug, propertyType }, 'No search URL generated')
        return []
      }

      logger.info({ provider: name, url }, 'Starting respectful scrape')
      let html
      try {
        html = await fetchHtml(url, { timeoutMs })
        await sleep(delayMs)
      } catch (err) {
        logger.warn({ provider: name, err: err.message }, 'Search page fetch failed')
        return []
      }

      const listingUrls = extractListingUrls(html, baseUrl).slice(0, maxListings)
      if (listingUrls.length === 0) {
        logger.debug({ provider: name }, 'No listing URLs found on search page')
        return []
      }

      const listings = []
      for (let i = 0; i < Math.min(listingUrls.length, maxListings); i++) {
        const listingUrl = listingUrls[i]
        try {
          const pageHtml = await fetchHtml(listingUrl, { timeoutMs })
          const parsed = parseListingPage(pageHtml, listingUrl)
          if (parsed && parsed.price) {
            listings.push({
              source: name,
              source_url: listingUrl,
              ...parsed,
            })
          }
          await sleep(delayMs)
        } catch (err) {
          logger.warn({ provider: name, url: listingUrl, err: err.message }, 'Listing page fetch failed')
        }
      }

      logger.info({ provider: name, count: listings.length }, 'Scrape completed')
      return listings
    },
  }
}

function extractListingUrls(html, baseUrl) {
  const seen = new Set()
  const urls = []
  // Conservative regex for common listing detail paths.
  const regex = /href="(\/[^"]+\/(?:property|listing|ad|item)\/[^"]+)"/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    let resolved
    try {
      resolved = new URL(match[1], baseUrl).href
    } catch {
      continue
    }
    if (!seen.has(resolved)) {
      seen.add(resolved)
      urls.push(resolved)
    }
  }
  return urls
}

/**
 * OLX Lebanon provider.
 * Note: OLX markup changes frequently. This provider is defensive and may
 * need maintenance as the site evolves.
 */
function createOlxLebanonProvider() {
  return createRespectfulHtmlProvider({
    name: 'olx_lebanon',
    baseUrl: 'https://www.olx.com.lb',
    buildSearchUrl({ area, propertyType, config }) {
      const q = encodeURIComponent(`${propertyType || 'apartment'} ${area?.name || 'lebanon'}`)
      return `https://www.olx.com.lb/properties/q-${q}/`
    },
    parseListingPage(html, sourceUrl) {
      const jsonLds = extractJsonLd(html)
      const offer = jsonLds.find((j) => j['@type'] === 'Product' || (Array.isArray(j['@type']) && j['@type'].includes('Product')))
      if (offer) {
        return {
          title: offer.name || null,
          price: sanitizeNumber(offer.offers?.price),
          currency: offer.offers?.priceCurrency || 'USD',
          external_id: offer.sku || null,
          location_text: extractLocationFromHtml(html),
        }
      }
      // Fallback to heuristics.
      const priceMatch = html.match(/class="[^"]*price[^"]*"[^>]*>([^<]+)/i)
      const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
      return {
        title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null,
        price: priceMatch ? sanitizeNumber(priceMatch[1]) : null,
        currency: 'USD',
        external_id: null,
        location_text: extractLocationFromHtml(html),
      }
    },
  })
}

/**
 * Property Finder Lebanon provider.
 */
function createPropertyFinderLbProvider() {
  return createRespectfulHtmlProvider({
    name: 'property_finder_lb',
    baseUrl: 'https://www.propertyfinder.lb',
    buildSearchUrl({ area, propertyType, config }) {
      const location = encodeURIComponent(area?.name || 'lebanon')
      const type = encodeURIComponent(propertyType || 'apartment')
      return `https://www.propertyfinder.lb/en/search?c=1&pf_mr=${type}&loc=${location}`
    },
    parseListingPage(html, sourceUrl) {
      const jsonLds = extractJsonLd(html)
      const offer = jsonLds.find((j) => j['@type'] === 'Product' || j['@type'] === 'Residence')
      if (offer) {
        return {
          title: offer.name || null,
          price: sanitizeNumber(offer.offers?.price),
          currency: offer.offers?.priceCurrency || 'USD',
          external_id: offer.sku || null,
          location_text: offer.address?.addressLocality || extractLocationFromHtml(html),
        }
      }
      const priceMatch = html.match(/data-testid="price"[^>]*>([^<]+)/i)
      const titleMatch = html.match(/data-testid="property-title"[^>]*>([^<]+)/i)
      return {
        title: titleMatch ? titleMatch[1].trim() : null,
        price: priceMatch ? sanitizeNumber(priceMatch[1]) : null,
        currency: 'USD',
        external_id: null,
        location_text: extractLocationFromHtml(html),
      }
    },
  })
}

/**
 * Government records provider. Requires a configured API endpoint.
 */
function createGovernmentRecordsProvider() {
  return {
    name: 'government_records',
    async fetchListings({ area, propertyType, config, logger }) {
      const apiUrl = config?.api_url || process.env.GOVERNMENT_RECORDS_API_URL
      const apiKey = config?.api_key || process.env.GOVERNMENT_RECORDS_API_KEY
      if (!apiUrl || !apiKey) {
        logger.debug('Government records API not configured; skipping')
        return []
      }
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        const res = await fetch(`${apiUrl}?area=${encodeURIComponent(area?.name || '')}&type=${encodeURIComponent(propertyType || '')}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        return (Array.isArray(data) ? data : []).map((item) => ({
          source: 'government_records',
          source_url: item.url || null,
          title: item.title || null,
          price: sanitizeNumber(item.price),
          currency: item.currency || 'USD',
          external_id: item.id || null,
          property_type: item.property_type || propertyType,
          location_text: item.location || area?.name,
        }))
      } catch (err) {
        logger.warn({ err: err.message }, 'Government records fetch failed')
        return []
      }
    },
  }
}

/**
 * AI provider. Generates synthetic comparables for an area/property type.
 * These are clearly labeled as estimates and are disabled by default.
 */
function createAiProvider({ aiAdapter, currencyService }) {
  return {
    name: 'ai_estimated',
    async fetchListings({ area, propertyType, config, logger }) {
      if (!aiAdapter) {
        logger.debug('AI provider skipped: no AI adapter available')
        return []
      }
      const count = config?.synthetic_count || 3
      try {
        const prompt = `You are a Lebanon real-estate data analyst. Generate ${count} realistic comparable listings for ${propertyType || 'apartment'} in ${area?.name || 'Lebanon'}.
Return strictly JSON in this format:
{
  "listings": [
    {
      "title": "...",
      "price": 250000,
      "currency": "USD",
      "property_type": "apartment",
      "bedrooms": 2,
      "bathrooms": 2,
      "area_sqm": 120,
      "location_text": "...",
      "condition": "good",
      "furnished": "unfurnished",
      "view_type": "city_view",
      "payment_method": "cash"
    }
  ]
}
Only return the JSON object, no markdown.`
        const { result } = await aiAdapter.generateMarketContextSentence?.({ prompt, provider: config?.ai_provider })
        if (!result) return []
        const parsed = typeof result === 'string' ? safeJsonParse(result) : result
        const listings = parsed?.listings || []
        return listings.map((item, i) => ({
          source: 'ai_estimated',
          source_url: null,
          external_id: `ai-${area?.slug || 'unknown'}-${propertyType || 'property'}-${i}`,
          ...item,
        }))
      } catch (err) {
        logger.warn({ err: err.message }, 'AI comparable generation failed')
        return []
      }
    },
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    try {
      const match = text.match(/\{[\s\S]*\}/)
      return match ? JSON.parse(match[0]) : null
    } catch {
      return null
    }
  }
}

function extractLocationFromHtml(html) {
  const match = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i)
  return match ? match[1] : null
}

export function createScraperProvider({ name, aiAdapter, currencyService }) {
  switch (name) {
    case 'manual': return createManualProvider()
    case 'olx_lebanon': return createOlxLebanonProvider()
    case 'property_finder_lb': return createPropertyFinderLbProvider()
    case 'government_records': return createGovernmentRecordsProvider()
    case 'ai': return createAiProvider({ aiAdapter, currencyService })
    default: return createManualProvider()
  }
}
