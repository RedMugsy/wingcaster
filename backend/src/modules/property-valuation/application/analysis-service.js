import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'node:crypto'
import { Collections } from '../infrastructure/db.js'
import { ConfidenceLevel, PricePosition } from '../domain/types.js'

export function createAnalysisService({
  dal,
  adapter,
  configService,
  currencyService,
  comparableService,
  aiAdapter,
  config,
  logger,
}) {
  async function getAnalysis(propertyId, options = {}) {
    const matchConfigRecord = options.matchConfigId
      ? await configService.getConfigById(options.matchConfigId)
      : await configService.getDefaultConfig()
    if (!matchConfigRecord) throw new Error('Pricing match configuration not found')
    const matchConfigId = matchConfigRecord.id
    const existing = await dal.findOne(
      Collections.PROPERTY_PRICE_ANALYSES,
      (a) => a.property_id === propertyId && a.match_config_id === matchConfigId
    )

    if (!options.force && existing && existing.expires_at && new Date(existing.expires_at) > new Date()) {
      return await enrichAnalysis(existing)
    }

    return analyzeProperty(propertyId, { ...options, matchConfigRecord })
  }

  async function analyzeProperty(propertyId, options = {}) {
    const property = await adapter.getPropertyById(propertyId)
    if (!property) throw new Error('Property not found')

    const matchConfigRecord = options.matchConfigRecord || (options.matchConfigId
      ? await configService.getConfigById(options.matchConfigId)
      : await configService.getDefaultConfig())
    if (!matchConfigRecord) throw new Error('Pricing match configuration not found')
    const matchConfig = matchConfigRecord?.config_json || config.defaultMatchConfig

    const comparables = await comparableService.findComparables(property, {
      matchConfig,
      matchConfigId: matchConfigRecord?.id,
    })

    const area = await comparableService.resolveAreaForProperty(property)
    const targetNormalized = await normalizeTarget(property)
    const targetNormalizedAmount = targetNormalized.amount

    const evidence = toWeightedEvidence(comparables)
    const sortedEvidence = [...evidence].sort((a, b) => a.value - b.value)
    const stats = computeWeightedStats(sortedEvidence)

    const targetVsMedianPercent = stats.median > 0 ? ((targetNormalizedAmount - stats.median) / stats.median) * 100 : 0
    const targetVsMedian = classifyPosition(targetVsMedianPercent)
    const targetPercentile = stats.median > 0 ? weightedPercentileRank(sortedEvidence, targetNormalizedAmount) : null
    const effectiveCount = effectiveSampleSize(sortedEvidence)
    const confidence = classifyConfidence(effectiveCount)
    const confidenceReason = buildConfidenceReason(comparables.length, area, effectiveCount)

    const sentence = await buildMarketContextSentence({
      property,
      area,
      comparables,
      stats,
      targetNormalized,
      targetVsMedian,
      confidence,
    })

    const now = new Date()
    const expiresAt = new Date(now.getTime() + config.analysisExpiryDays * 24 * 60 * 60 * 1000)

    const existing = await dal.findOne(
      Collections.PROPERTY_PRICE_ANALYSES,
      (a) => a.property_id === propertyId && a.match_config_id === matchConfigRecord.id
    )
    const lowestComparable = sortedEvidence[0]?.comparable || null
    const highestComparable = sortedEvidence[sortedEvidence.length - 1]?.comparable || null
    const runId = uuidv4()
    const analysis = {
      id: existing?.id || uuidv4(),
      property_id: propertyId,
      match_config_id: matchConfigRecord.id,
      comparable_count: comparables.length,
      lowest_price: stats.lowest,
      lowest_price_property_id: lowestComparable?.id || null,
      lowest_price_comparable_type: comparableType(lowestComparable),
      highest_price: stats.highest,
      highest_price_property_id: highestComparable?.id || null,
      highest_price_comparable_type: comparableType(highestComparable),
      median_price: stats.median,
      mean_price: stats.mean,
      percentile_25: stats.p25,
      percentile_75: stats.p75,
      target_percentile: targetPercentile,
      target_vs_median: targetVsMedian,
      target_vs_median_percent: Number(targetVsMedianPercent.toFixed(2)),
      confidence,
      confidence_reason: confidenceReason,
      market_context_sentence: sentence,
      currency_normalized: config.baseCurrency,
      parallel_rate_used: targetNormalized.rate || null,
      target_price: targetNormalizedAmount,
      analysis_inputs_hash: analysisInputsHash(property, matchConfigRecord, targetNormalized),
      rate_source: targetNormalized.rate_source || null,
      rate_effective_at: targetNormalized.rate_effective_at || null,
      rate_is_stale: Boolean(targetNormalized.is_stale),
      rate_age_hours: targetNormalized.rate_age_hours ?? null,
      latest_run_id: runId,
      calculated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      data: {
        comparables_used: comparables.map((c) => c.id),
        match_config: matchConfig,
        target_price: targetNormalizedAmount,
        effective_sample_size: effectiveCount,
        estimator: 'weighted_quantiles_and_weighted_mean',
      },
    }

    // Upsert cached analysis
    if (existing) {
      await dal.update(
        Collections.PROPERTY_PRICE_ANALYSES,
        (a) => a.id === existing.id,
        () => analysis
      )
    } else {
      await dal.insert(Collections.PROPERTY_PRICE_ANALYSES, analysis)
    }
    await persistEvidence(analysis, runId, comparables)

    return await enrichAnalysis(analysis, comparables)
  }

  async function analyzeDraft(property) {
    const matchConfig = await configService.getDefaultConfig()
    const comparables = await comparableService.findComparables(property, { matchConfig: matchConfig?.config_json || config.defaultMatchConfig })
    const area = await comparableService.resolveAreaForProperty(property)
    const targetNormalized = await normalizeTarget(property)
    const targetNormalizedAmount = targetNormalized.amount
    const weightedEvidence = toWeightedEvidence(comparables).sort((a, b) => a.value - b.value)
    const stats = computeWeightedStats(weightedEvidence)
    const targetVsMedianPercent = stats.median > 0 ? ((targetNormalizedAmount - stats.median) / stats.median) * 100 : 0
    const targetVsMedian = classifyPosition(targetVsMedianPercent)
    const confidence = classifyConfidence(effectiveSampleSize(weightedEvidence))

    if (confidence === ConfidenceLevel.LOW) {
      return `Market context: Limited comparable data in ${area?.name || 'this area'}.`
    }

    return await buildMarketContextSentence({
      property,
      area,
      comparables,
      stats,
      targetNormalized,
      targetVsMedian,
      confidence,
    })
  }

  async function normalizeTarget(property) {
    const currency = getField(property, 'currency') || config.baseCurrency
    const paymentMethod = getField(property, 'payment_method') || 'unspecified'
    const condition = getField(property, 'condition') || 'unknown'
    const furnished = getField(property, 'furnished') || 'unknown'
    const viewType = getField(property, 'view_type') || 'unknown'

    const rules = await dal.findAll(Collections.PRICING_NORMALIZATION_RULES, (r) => r.is_active === true)
    const normalized = await currencyService.normalizeToUsd(Number(property.price), currency)
    let price = normalized.amount
    price = applyRuleAdjustment(price, rules, 'payment_method', paymentMethod)
    price = applyRuleAdjustment(price, rules, 'condition', condition)
    price = applyRuleAdjustment(price, rules, 'furnished', furnished)
    price = applyRuleAdjustment(price, rules, 'view', viewType)
    return {
      ...normalized,
      amount: Number(price.toFixed(2)),
    }
  }

  async function buildMarketContextSentence({ property, area, comparables, stats, targetNormalized, targetVsMedian, confidence }) {
    const context = {
      areaName: area?.name,
      propertyType: property.property_type,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      areaSqm: property.area,
      comparableCount: comparables.length,
      lowestPrice: stats.lowest,
      highestPrice: stats.highest,
      medianPrice: stats.median,
      targetPrice: targetNormalized.amount,
      targetVsMedian,
      confidence,
    }

    if (!aiAdapter) {
      return deterministicSentence(context)
    }

    try {
      return await aiAdapter.generateMarketContextSentence(context)
    } catch (err) {
      logger.warn({ err: err.message }, 'AI market context sentence failed; using fallback')
      return deterministicSentence(context)
    }
  }

  async function persistEvidence(analysis, runId, comparables) {
    if (!dal.insert) return
    await dal.insert(Collections.ANALYSIS_RUNS, {
      id: runId,
      analysis_id: analysis.id,
      property_id: analysis.property_id,
      match_config_id: analysis.match_config_id,
      analysis_inputs_hash: analysis.analysis_inputs_hash,
      calculated_at: analysis.calculated_at,
      result: analysis,
      created_at: analysis.calculated_at,
      updated_at: analysis.calculated_at,
      data: {},
    })
    for (const comparable of comparables) {
      const normalization = comparable.normalization_meta || {}
      await dal.insert(Collections.ANALYSIS_COMPARABLE_EVIDENCE, {
        id: uuidv4(),
        analysis_run_id: runId,
        property_id: analysis.property_id,
        comparable_type: comparableType(comparable),
        comparable_id: comparable.id,
        source: comparable.provider_source || comparable.source || 'unknown',
        source_label: comparable.source_label || null,
        original_price: Number(comparable.price ?? comparable.sold_price) || null,
        original_currency: comparable.currency || null,
        normalized_price: Number(comparable.normalized_price),
        normalization_rate: normalization.rate ?? null,
        rate_source: normalization.rate_source || null,
        rate_effective_at: normalization.rate_effective_at || null,
        rate_is_stale: Boolean(normalization.rate_is_stale),
        similarity_score: Number(comparable.similarity_score) || 0,
        time_weight: Number(comparable.time_weight) || 0,
        weight: normalizedWeight(comparable.weight),
        listed_at: comparable.created_at || comparable.scraped_at || comparable.sold_date || comparable.listed_date || null,
        area_sqm: Number(comparable.area ?? comparable.area_sqm) || null,
        created_at: analysis.calculated_at,
        updated_at: analysis.calculated_at,
        data: {
          title: comparable.title || comparable.external_property_title || null,
          location: comparable.location || comparable.location_text || comparable.external_property_location || null,
          bedrooms: comparable.bedrooms ?? null,
          bathrooms: comparable.bathrooms ?? null,
          condition: comparable.condition || null,
          source_url: comparable.source_url || null,
        },
      })
    }
  }

  async function enrichAnalysis(analysis, comparables = []) {
    let summaries = comparables
    if (!summaries.length && dal.findAll) {
      summaries = await dal.findAll(Collections.ANALYSIS_COMPARABLE_EVIDENCE, (item) => item.analysis_run_id === analysis.latest_run_id)
    }
    return {
      ...analysis,
      target_price: analysis.target_price ?? analysis.data?.target_price ?? null,
      comparables_summary: summaries.map((c) => ({
        id: c.comparable_id || c.id,
        source: c.source,
        source_label: c.source_label,
        price: c.original_price ?? c.price,
        currency: c.original_currency ?? c.currency,
        normalized_price: c.normalized_price,
        similarity_score: c.similarity_score,
        weight: c.weight,
        listed_at: c.listed_at || c.created_at || c.scraped_at || c.sold_date,
        area_sqm: c.area_sqm ?? c.area,
        data: c.data,
      })),
    }
  }

  return {
    getAnalysis,
    analyzeProperty,
    analyzeDraft,
  }
}

function computeWeightedStats(sortedEntries) {
  if (!sortedEntries.length) {
    return { lowest: null, highest: null, median: null, mean: null, p25: null, p75: null }
  }
  const totalWeight = sortedEntries.reduce((sum, entry) => sum + entry.weight, 0)
  return {
    lowest: sortedEntries[0].value,
    highest: sortedEntries[sortedEntries.length - 1].value,
    median: weightedQuantile(sortedEntries, 0.5),
    mean: Number((sortedEntries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight).toFixed(2)),
    p25: weightedQuantile(sortedEntries, 0.25),
    p75: weightedQuantile(sortedEntries, 0.75),
  }
}

function weightedQuantile(sortedEntries, quantile) {
  if (!sortedEntries.length) return null
  if (sortedEntries.length === 1) return sortedEntries[0].value
  const totalWeight = sortedEntries.reduce((sum, entry) => sum + entry.weight, 0)
  const positions = []
  let cumulative = 0
  for (const entry of sortedEntries) {
    cumulative += entry.weight
    positions.push((cumulative - entry.weight / 2) / totalWeight)
  }
  if (quantile <= positions[0]) return sortedEntries[0].value
  if (quantile >= positions[positions.length - 1]) return sortedEntries[sortedEntries.length - 1].value
  const upperIndex = positions.findIndex((position) => position >= quantile)
  const lowerIndex = upperIndex - 1
  const span = positions[upperIndex] - positions[lowerIndex]
  const fraction = span > 0 ? (quantile - positions[lowerIndex]) / span : 0
  return Number((sortedEntries[lowerIndex].value * (1 - fraction) + sortedEntries[upperIndex].value * fraction).toFixed(2))
}

function weightedPercentileRank(sortedEntries, value) {
  if (!sortedEntries.length) return null
  const totalWeight = sortedEntries.reduce((sum, entry) => sum + entry.weight, 0)
  const belowWeight = sortedEntries.reduce((sum, entry) => sum + (entry.value < value ? entry.weight : 0), 0)
  return Number(((belowWeight / totalWeight) * 100).toFixed(2))
}

function normalizedWeight(value) {
  const weight = Number(value)
  return Number.isFinite(weight) && weight > 0 ? weight : 0.0001
}

function toWeightedEvidence(comparables) {
  return comparables
    .map((comparable) => ({ value: Number(comparable.normalized_price), weight: normalizedWeight(comparable.weight), comparable }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
}

function effectiveSampleSize(entries) {
  if (!entries.length) return 0
  const sum = entries.reduce((total, entry) => total + entry.weight, 0)
  const squared = entries.reduce((total, entry) => total + entry.weight ** 2, 0)
  return squared > 0 ? Number(((sum ** 2) / squared).toFixed(2)) : 0
}

function comparableType(comparable) {
  if (!comparable) return null
  if (comparable.source === 'internal') return 'internal'
  if (comparable.source === 'agent_report') return 'agent_report'
  return 'external'
}

function analysisInputsHash(property, matchConfigRecord, targetNormalized) {
  const payload = {
    property: {
      price: property.price,
      currency: getField(property, 'currency'),
      property_type: property.property_type,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      area: property.area,
      building_age_years: getField(property, 'building_age_years'),
      condition: getField(property, 'condition'),
      furnished: getField(property, 'furnished'),
      view_type: getField(property, 'view_type'),
      payment_method: getField(property, 'payment_method'),
      latitude: property.latitude,
      longitude: property.longitude,
    },
    match_config_id: matchConfigRecord.id,
    match_config: matchConfigRecord.config_json,
    target_rate: targetNormalized.rate,
    target_rate_effective_at: targetNormalized.rate_effective_at,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function classifyPosition(percent) {
  if (percent < -5) return PricePosition.BELOW
  if (percent > 5) return PricePosition.ABOVE
  return PricePosition.AT
}

function classifyConfidence(count) {
  if (count >= 12) return ConfidenceLevel.HIGH
  if (count >= 5) return ConfidenceLevel.MEDIUM
  return ConfidenceLevel.LOW
}

function buildConfidenceReason(count, area, effectiveCount = count) {
  const effectiveLabel = effectiveCount < count ? ` (${effectiveCount.toFixed(1)} effective after weighting)` : ''
  if (effectiveCount >= 12) return `Based on ${count} similar properties${effectiveLabel}${area ? ` in ${area.name}` : ''}.`
  if (effectiveCount >= 5) return `Based on ${count} similar properties${effectiveLabel}${area ? ` in ${area.name}` : ''}; confidence is moderate.`
  if (count > 0) return `Only ${count} comparable property${count === 1 ? '' : 'ies'} found${area ? ` in ${area.name}` : ''}.`
  return `No comparable properties found${area ? ` in ${area.name}` : ''}.`
}

function deterministicSentence({ areaName, propertyType, bedrooms, comparableCount, lowestPrice, highestPrice, medianPrice, targetPrice, targetVsMedian, confidence }) {
  const typeLabel = `${bedrooms ? `${bedrooms}-bedroom ` : ''}${propertyType || 'property'}`
  const range = `${formatCurrency(lowestPrice)}–${formatCurrency(highestPrice)}`
  const area = areaName || 'this area'

  if (comparableCount === 0) {
    return `No comparable ${typeLabel}s found in ${area} right now, so price guidance has low confidence.`
  }

  let sentence = `Similar ${typeLabel}s in ${area} are listed between ${range} (median: ${formatCurrency(medianPrice)}). Your price of ${formatCurrency(targetPrice)} is ${targetVsMedian} the median.`
  if (confidence === ConfidenceLevel.LOW) {
    sentence += ` Low confidence: only ${comparableCount} comparable${comparableCount === 1 ? '' : 's'} found.`
  }
  return sentence
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  const num = Number(value)
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`
  return `$${num.toLocaleString()}`
}

function getField(obj, key) {
  if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  if (obj.data && typeof obj.data === 'object' && obj.data[key] !== undefined && obj.data[key] !== null) {
    return obj.data[key]
  }
  return undefined
}

function applyRuleAdjustment(price, rules, ruleType, value) {
  const rule = rules.find(
    (r) => r.rule_type === ruleType && String(r.value).toLowerCase() === String(value || 'unknown').toLowerCase()
  )
  if (!rule) return price
  return price * (1 + Number(rule.adjustment_percent) / 100)
}
