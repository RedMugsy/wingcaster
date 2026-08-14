import { createAiAdapter as createWhatsAppAiAdapter } from '../../whatsapp-listings/infrastructure/ai/adapter.js'

export function createAiAdapter({ config, logger }) {
  // Reuse the WhatsApp module AI adapter; it supports multiple providers and fallbacks.
  const whatsAppAdapter = createWhatsAppAiAdapter({ config: { aiProvider: config.aiProvider, fallbackAiProviders: config.fallbackAiProviders }, logger })

  async function generateMarketContextSentence(context) {
    const prompt = buildMarketContextPrompt(context)
    try {
      const result = await whatsAppAdapter.generateMarketContextSentence({ prompt, provider: config.aiProvider })
      return result.sentence
    } catch (err) {
      logger.warn({ err: err.message }, 'AI market context generation failed; using deterministic fallback')
      return deterministicSentence(context)
    }
  }

  return {
    generateMarketContextSentence,
  }
}

function buildMarketContextPrompt({ areaName, propertyType, bedrooms, bathrooms, areaSqm, comparableCount, lowestPrice, highestPrice, medianPrice, targetPrice, targetVsMedian, confidence }) {
  return `You are a concise real-estate analyst for Lebanon. Write one short sentence (max 35 words) summarizing how a property's price compares to similar listings. Be transparent about uncertainty.

Context:
- Area: ${areaName || 'this area'}
- Property type: ${propertyType || 'property'}${bedrooms ? `, ${bedrooms} bedrooms` : ''}${bathrooms ? `, ${bathrooms} bathrooms` : ''}${areaSqm ? `, ${areaSqm} sqm` : ''}
- Comparable listings found: ${comparableCount}
- Comparable price range: ${formatCurrency(lowestPrice)} – ${formatCurrency(highestPrice)}
- Median comparable price: ${formatCurrency(medianPrice)}
- Target listing price: ${formatCurrency(targetPrice)}
- Target vs median: ${targetVsMedian}
- Confidence: ${confidence}

Return strictly JSON in this format: { "sentence": "..." }. Do not add markdown or explanation.`
}

function deterministicSentence({ areaName, propertyType, bedrooms, comparableCount, lowestPrice, highestPrice, medianPrice, targetPrice, targetVsMedian, confidence }) {
  const typeLabel = `${bedrooms ? `${bedrooms}-bedroom ` : ''}${propertyType || 'property'}`
  const range = `${formatCurrency(lowestPrice)}–${formatCurrency(highestPrice)}`
  const area = areaName || 'this area'

  let base = `Similar ${typeLabel}s in ${area} are listed between ${range} (median: ${formatCurrency(medianPrice)}). Your price of ${formatCurrency(targetPrice)} is ${targetVsMedian} the median.`
  if (comparableCount === 0) {
    base = `No comparable ${typeLabel}s found in ${area} right now, so price guidance has low confidence.`
  } else if (confidence === 'low') {
    base += ` Low confidence: only ${comparableCount} comparable${comparableCount === 1 ? '' : 's'} found.`
  }
  return base
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  const num = Number(value)
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`
  return `$${num.toLocaleString()}`
}
