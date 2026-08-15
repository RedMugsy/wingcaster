/**
 * HTTP routes for the listings-ai module.
 *
 * POST /api/listings-ai/describe
 *   Body: {
 *     photo_urls: string[],           // required (1..config.maxPhotos)
 *     hints?: {                       // optional context to steer the model
 *       city?: string
 *       neighborhood?: string
 *       type?: 'sale' | 'rent'
 *       property_type?: string
 *       price?: number
 *       currency?: string
 *       notes?: string
 *     },
 *     provider?: string,              // optional override (claude|openai|...)
 *     intent?: 'create' | 'update',   // default 'create'
 *     existing_listing?: object       // when intent = 'update', the current listing
 *   }
 *   Returns: {
 *     property: {
 *       title, description, type, property_type, price, price_unit,
 *       bedrooms, bathrooms, area, area_unit,
 *       location, city, neighborhood, address,
 *       amenities, furnished, features, confidence
 *     },
 *     provider,
 *     change_summary?
 *   }
 */

export function registerListingsAiRoutes(app, { aiAdapter, config, logger, authMiddleware, emitUsageEventAsync: emitUsageEvent }) {
  const auth = authMiddleware || ((_req, _res, next) => next())

  app.post('/api/listings-ai/describe', auth, async (req, res) => {
    const started = Date.now()
    const {
      photo_urls,
      hints,
      provider,
      intent,
      existing_listing: existingListing,
    } = req.body || {}

    if (!Array.isArray(photo_urls) || photo_urls.length === 0) {
      return res.status(400).json({ error: 'photo_urls must be a non-empty array' })
    }
    if (photo_urls.length > config.maxPhotos) {
      return res.status(400).json({
        error: `Too many photos (max ${config.maxPhotos})`,
      })
    }

    const validUrls = photo_urls.filter((u) => typeof u === 'string' && u.trim().length > 0)
    if (validUrls.length === 0) {
      return res.status(400).json({ error: 'photo_urls must contain valid strings' })
    }

    const images = validUrls.map((url) => ({ url }))
    const messages = buildHintMessages(hints)

    try {
      const result = await aiAdapter.extractProperty({
        messages,
        images,
        provider: provider || undefined,
        intent: intent === 'update' ? 'update' : 'create',
        existingListing: existingListing || null,
      })
      const elapsed = Date.now() - started
      logger.info(
        {
          agentId: req.user?.id,
          photoCount: images.length,
          provider: result.provider,
          confidence: result.property?.confidence,
          elapsedMs: elapsed,
        },
        'listings-ai describe complete',
      )
      if (typeof emitUsageEvent === 'function' && req.user?.id) {
        emitUsageEvent({
          actionKey: 'ai.description.generated',
          tenantId: req.user.id,
          quantity: 1,
          metadata: {
            provider: result.provider,
            photo_count: images.length,
            ai_duration_ms: elapsed,
            ai_success: true,
          },
        })
      }
      return res.json({
        property: result.property,
        provider: result.provider,
        change_summary: result.changeSummary || null,
      })
    } catch (err) {
      const elapsed = Date.now() - started
      logger.warn(
        { err: err.message, agentId: req.user?.id, photoCount: images.length },
        'listings-ai describe failed',
      )
      if (typeof emitUsageEvent === 'function' && req.user?.id) {
        emitUsageEvent({
          actionKey: 'ai.description.failed',
          tenantId: req.user.id,
          quantity: 1,
          metadata: {
            provider: provider || null,
            photo_count: images.length,
            ai_duration_ms: elapsed,
            ai_success: false,
          },
        })
      }
      return res.status(502).json({
        error: 'AI extraction failed',
        detail: err.message,
      })
    }
  })
}

function buildHintMessages(hints) {
  if (!hints || typeof hints !== 'object') return []
  const parts = []
  if (hints.type) parts.push(`Listing intent: ${hints.type === 'rent' ? 'for rent' : 'for sale'}.`)
  if (hints.property_type) parts.push(`Property type is ${hints.property_type}.`)
  if (hints.city || hints.neighborhood) {
    const loc = [hints.neighborhood, hints.city].filter(Boolean).join(', ')
    parts.push(`Location: ${loc}.`)
  }
  if (typeof hints.price === 'number' && hints.price > 0) {
    parts.push(`Asking price: ${hints.price}${hints.currency ? ` ${hints.currency}` : ''}.`)
  }
  if (hints.notes) parts.push(`Notes from agent: ${hints.notes}`)
  if (!parts.length) return []
  return [{ role: 'user', text: parts.join(' ') }]
}
