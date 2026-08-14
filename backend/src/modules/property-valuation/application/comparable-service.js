import { Collections } from '../infrastructure/db.js'

function exponentialDecay(delta, lambda) {
  return Math.exp(-lambda * Math.abs(delta))
}

function getField(obj, ...keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  }
  if (obj.data && typeof obj.data === 'object') {
    for (const key of keys) {
      if (obj.data[key] !== undefined && obj.data[key] !== null) return obj.data[key]
    }
  }
  return undefined
}

export function createComparableService({ dal, adapter, currencyService, config, logger }) {
  async function findComparables(targetProperty, options = {}) {
    const matchConfig = options.matchConfig || config.defaultMatchConfig
    const limit = matchConfig.max_comparables || config.defaultMatchConfig.max_comparables

    const area = await resolveAreaForProperty(targetProperty)
    const rules = await dal.findAll(Collections.PRICING_NORMALIZATION_RULES, (r) => r.is_active === true)

    // Load internal candidates using PostGIS radius when coordinates are available.
    let internalCandidates = await findInternalCandidates(targetProperty, matchConfig, area)
    internalCandidates = internalCandidates.filter((p) => p.id !== targetProperty.id)

    // Numeric filters
    internalCandidates = internalCandidates.filter((p) => matchesNumericFilters(p, targetProperty, matchConfig))

    // Recency filter
    if (matchConfig.max_days_since_listed) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - matchConfig.max_days_since_listed)
      internalCandidates = internalCandidates.filter((p) => {
        const listed = p.created_at || p.listed_date
        return listed ? new Date(listed) >= cutoff : false
      })
    }

    // Normalize prices to USD and apply premiums/adjustments
    const normalizedInternal = (await Promise.all(
      internalCandidates.map(async (p) => {
        const norm = await normalizeComparableSafely(p, rules)
        return norm ? { ...p, normalized_price: norm.price, normalization_meta: norm, price_per_sqm: norm.price_per_sqm } : null
      })
    )).filter(Boolean)

    // Load external comparables using PostGIS radius when coordinates are available.
    const externalCandidates = await findExternalCandidates(targetProperty, matchConfig, area)
    const normalizedExternal = (await Promise.all(
      externalCandidates.map(async (ec) => {
        const norm = await normalizeComparableSafely({ ...ec, area: ec.area_sqm }, rules, ec.price_normalized_usd)
        if (!norm) return null
        return {
          ...ec,
          source: 'external',
          provider_source: ec.source,
          source_label: ec.source_label || ec.source,
          normalized_price: norm.price,
          normalization_meta: norm,
          price_per_sqm: norm.price_per_sqm,
        }
      })
    )).filter(Boolean)

    // Load verified agent-reported sold prices as a Tier 1 source.
    const agentReportCandidates = await findAgentReportCandidates(targetProperty, matchConfig, area, rules)

    const allCandidates = [
      ...normalizedInternal.map((p) => ({ ...p, source: 'internal' })),
      ...normalizedExternal,
      ...agentReportCandidates.map((r) => ({
        ...r,
        source: 'agent_report',
        source_label: 'Verified sold price report',
        normalized_price: r.normalized_price,
        price_per_sqm: r.area_sqm > 0 ? r.normalized_price / Number(r.area_sqm) : null,
      })),
    ].filter((c) => Number(c.normalized_price) > 0)

    if (!allCandidates.length) {
      return []
    }

    // Outlier quarantine using IQR per property type, then global fallback.
    const filtered = quarantineOutliers(allCandidates, targetProperty)

    // Score similarity
    const targetAge = Number(getField(targetProperty, 'building_age_years', 'age')) || null
    const targetLat = Number(targetProperty.latitude) || null
    const targetLon = Number(targetProperty.longitude) || null

    const scored = filtered.map((c) => {
      const age = Number(getField(c, 'building_age_years', 'age')) || targetAge
      const cLat = Number(c.latitude) || null
      const cLon = Number(c.longitude) || null

      const comparableArea = Number(getField(c, 'area', 'area_sqm'))
      const areaDelta = targetProperty.area && Number.isFinite(comparableArea) ? (comparableArea - Number(targetProperty.area)) : 0
      const bedDelta = targetProperty.bedrooms != null && c.bedrooms != null ? (Number(c.bedrooms) - Number(targetProperty.bedrooms)) : 0
      const bathDelta = targetProperty.bathrooms != null && c.bathrooms != null ? (Number(c.bathrooms) - Number(targetProperty.bathrooms)) : 0
      const ageDelta = targetAge != null && age != null ? (age - targetAge) : 0
      const distanceKm = targetLat != null && targetLon != null && cLat != null && cLon != null
        ? haversineKm(targetLat, targetLon, cLat, cLon)
        : 0

      const score =
        exponentialDecay(areaDelta, 0.05) *
        exponentialDecay(bedDelta, 0.8) *
        exponentialDecay(bathDelta, 0.8) *
        exponentialDecay(ageDelta, 0.15) *
        exponentialDecay(distanceKm, 0.3)

      const listedDate = c.created_at || c.scraped_at || c.listed_date || new Date().toISOString()
      const daysSinceListed = Math.max(0, (Date.now() - new Date(listedDate).getTime()) / (1000 * 60 * 60 * 24))
      const timeWeight = Math.exp(-0.01 * daysSinceListed)
      const weight = score * timeWeight

      return {
        ...c,
        similarity_score: Number(score.toFixed(4)),
        time_weight: Number(timeWeight.toFixed(4)),
        weight: Number(weight.toFixed(4)),
        days_since_listed: Math.round(daysSinceListed),
      }
    })

    scored.sort((a, b) => b.weight - a.weight)
    return scored.slice(0, limit)
  }

  async function findInternalCandidates(targetProperty, matchConfig, area) {
    const filters = {
      status: 'active',
      property_type: matchConfig.same_property_type !== false ? targetProperty.property_type : undefined,
      excludeId: targetProperty.id,
    }

    const targetLat = Number(targetProperty.latitude)
    const targetLon = Number(targetProperty.longitude)

    if (matchConfig.same_area !== false && Number.isFinite(targetLat) && Number.isFinite(targetLon)) {
      try {
        return await adapter.findNearbyProperties({
          latitude: targetLat,
          longitude: targetLon,
          radiusMeters: matchConfig.radius_meters || 5000,
          filters,
        })
      } catch (err) {
        logger.warn({ err: err.message }, 'PostGIS nearby property query failed; falling back to name-based lookup')
      }
    }

    // Fallback: load by name and status if PostGIS is unavailable or coordinates missing.
    let rows = await adapter.getProperties(filters)
    if (matchConfig.same_area !== false) {
      rows = rows.filter((p) => sameAreaOrNearby(p, targetProperty, area, matchConfig.radius_meters || 5000))
    }
    return rows
  }

  async function findExternalCandidates(targetProperty, matchConfig, area) {
    const enabledSources = await dal.findAll(Collections.PRICING_SOURCES, (s) => s.enabled === true && s.is_internal === false)
    if (enabledSources.length === 0) return []
    const sourceSlugs = enabledSources.map((s) => s.source)
    const sourceLabels = new Map(enabledSources.map((source) => [source.source, source.label || source.source]))

    const targetLat = Number(targetProperty.latitude)
    const targetLon = Number(targetProperty.longitude)

    if (matchConfig.same_area !== false && Number.isFinite(targetLat) && Number.isFinite(targetLon)) {
      try {
        let rows = await adapter.findNearbyExternalComparables({
          latitude: targetLat,
          longitude: targetLon,
          radiusMeters: matchConfig.radius_meters || 5000,
          filters: { status: 'active', property_type: matchConfig.same_property_type !== false ? targetProperty.property_type : undefined, sources: sourceSlugs },
        })
        rows = rows.filter((ec) => matchesNumericFiltersExternal(ec, targetProperty, matchConfig))
        if (rows.length > 0) return applyRecencyFilter(rows, matchConfig, ['scraped_at', 'created_at'])
          .map((row) => ({ ...row, source_label: sourceLabels.get(row.source) || row.source }))
      } catch (err) {
        logger.warn({ err: err.message }, 'PostGIS nearby external comparables query failed; falling back to name-based lookup')
      }
    }

    let rows = await dal.findAll(
      Collections.EXTERNAL_COMPARABLES,
      (ec) => sourceSlugs.includes(ec.source) && ec.status === 'active'
    )
    if (matchConfig.same_property_type !== false && targetProperty.property_type) {
      rows = rows.filter((ec) => ec.property_type === targetProperty.property_type)
    }
    if (matchConfig.same_area !== false && area) {
      rows = rows.filter((ec) => ec.area_id === area.id || sameAreaName(ec, area))
    }
    rows = rows.filter((ec) => matchesNumericFiltersExternal(ec, targetProperty, matchConfig))
    return applyRecencyFilter(rows, matchConfig, ['scraped_at', 'created_at'])
      .map((row) => ({ ...row, source_label: sourceLabels.get(row.source) || row.source }))
  }

  async function findAgentReportCandidates(targetProperty, matchConfig, area, rules) {
    const reports = await dal.findAll(
      Collections.AGENT_PRICE_REPORTS,
      (r) => r.status === 'verified'
    )
    if (reports.length === 0) return []

    let filtered = reports
    if (matchConfig.same_property_type !== false && targetProperty.property_type) {
      filtered = filtered.filter((r) => r.property_type === targetProperty.property_type)
    }
    if (matchConfig.same_area !== false && area) {
      filtered = filtered.filter((r) => {
        const loc = r.external_property_location ? String(r.external_property_location).toLowerCase() : ''
        const names = [area.name, area.name_ar, area.slug].filter(Boolean).map((n) => String(n).toLowerCase())
        return names.some((n) => loc.includes(n))
      })
    }
    filtered = filtered.filter((r) => matchesNumericFiltersExternal(r, targetProperty, matchConfig))
    filtered = applyRecencyFilter(filtered, matchConfig, ['sold_date', 'created_at'])

    return (await Promise.all(
      filtered.map(async (r) => {
        let norm
        try {
          norm = await currencyService.normalizeToUsd(Number(r.sold_price), r.currency || config.baseCurrency)
        } catch (err) {
          logger.warn({ err: err.message, reportId: r.id }, 'Excluded agent price report with unusable currency rate')
          return null
        }
        return {
          ...r,
          id: r.id,
          price: r.sold_price,
          price_normalized_usd: r.sold_price_normalized_usd || norm.amount,
          normalized_price: r.sold_price_normalized_usd || norm.amount,
          area_sqm: r.area_sqm,
          bedrooms: r.bedrooms,
          bathrooms: r.bathrooms,
          property_type: r.property_type,
          listed_date: r.sold_date,
          location_text: r.external_property_location,
          normalization_meta: {
            price: Number(r.sold_price_normalized_usd) || norm.amount,
            currency: r.currency || config.baseCurrency,
            rate: norm.rate,
            rate_source: norm.rate_source,
            rate_effective_at: norm.rate_effective_at,
            rate_is_stale: norm.is_stale,
          },
        }
      })
    )).filter(Boolean)
  }

  function quarantineOutliers(candidates, targetProperty) {
    // Stratify by property type so a villa does not pollute an apartment pool and vice versa.
    const typeGroups = new Map()
    for (const c of candidates) {
      const key = c.property_type || 'unknown'
      if (!typeGroups.has(key)) typeGroups.set(key, [])
      typeGroups.get(key).push(c)
    }

    let kept = []
    for (const group of typeGroups.values()) {
      const prices = group.map((c) => c.normalized_price).sort((a, b) => a - b)
      const bounds = iqrBounds(prices)
      const median = bounds ? bounds.median : percentile(prices, 50)
      for (const c of group) {
        const ratio = median > 0 ? c.normalized_price / median : 1
        const withinIqr = bounds ? c.normalized_price >= bounds.lower && c.normalized_price <= bounds.upper : true
        if (withinIqr && ratio >= 0.5 && ratio <= 4) {
          kept.push(c)
        } else {
          logger.debug({ propertyId: c.id, price: c.normalized_price, bounds, ratio }, 'Quarantined outlier comparable')
        }
      }
    }

    // If stratification leaves too few comparables, fall back to global IQR but keep ratio guard.
    if (kept.length < 3 && candidates.length >= 3) {
      const prices = candidates.map((c) => c.normalized_price).sort((a, b) => a - b)
      const bounds = iqrBounds(prices)
      const median = bounds ? bounds.median : percentile(prices, 50)
      if (bounds) {
        kept = candidates.filter((c) => {
          const ratio = median > 0 ? c.normalized_price / median : 1
          return c.normalized_price >= bounds.lower && c.normalized_price <= bounds.upper && ratio >= 0.5 && ratio <= 4
        })
      } else {
        kept = candidates.filter((c) => {
          const ratio = median > 0 ? c.normalized_price / median : 1
          return ratio >= 0.5 && ratio <= 4
        })
      }
    }

    return kept
  }

  function iqrBounds(sortedValues) {
    if (!sortedValues || sortedValues.length < 4) return null
    const q1 = percentile(sortedValues, 25)
    const q3 = percentile(sortedValues, 75)
    const iqr = q3 - q1
    if (iqr <= 0) return null
    const median = percentile(sortedValues, 50)
    return {
      lower: Math.max(0, q1 - 1.5 * iqr),
      upper: q3 + 1.5 * iqr,
      median,
      q1,
      q3,
    }
  }

  async function normalizePropertyPrice(property, rules) {
    const currency = getField(property, 'currency') || config.baseCurrency
    const paymentMethod = getField(property, 'payment_method') || 'unspecified'
    const condition = getField(property, 'condition') || 'unknown'
    const furnished = getField(property, 'furnished') || 'unknown'
    const viewType = getField(property, 'view_type') || 'unknown'

    // Currency normalization (payment-method adjustment is applied inside currency service)
    const norm = await currencyService.normalizeToUsd(Number(property.price), currency)
    let price = norm.amount

    // Payment method / condition / furnished / view premiums
    price = applyRuleAdjustment(price, rules, 'payment_method', paymentMethod)
    price = applyRuleAdjustment(price, rules, 'condition', condition)
    price = applyRuleAdjustment(price, rules, 'furnished', furnished)
    price = applyRuleAdjustment(price, rules, 'view', viewType)

    const area = Number(property.area) || Number(property.area_sqm) || 0
    return {
      price: Number(price.toFixed(2)),
      price_per_sqm: area > 0 ? Number((price / area).toFixed(2)) : null,
      currency,
      payment_method: paymentMethod,
      condition,
      furnished,
      view_type: viewType,
      rate: norm.rate,
      rate_source: norm.rate_source,
      rate_effective_at: norm.rate_effective_at,
      rate_is_stale: Boolean(norm.is_stale),
      rate_age_hours: norm.rate_age_hours,
    }
  }

  async function normalizeComparableSafely(property, rules, trustedNormalizedPrice) {
    try {
      if (Number(trustedNormalizedPrice) > 0 && String(property.currency || config.baseCurrency).toUpperCase() === String(config.baseCurrency).toUpperCase()) {
        property = { ...property, price: Number(trustedNormalizedPrice), currency: config.baseCurrency }
      }
      return await normalizePropertyPrice(property, rules)
    } catch (err) {
      logger.warn({ err: err.message, comparableId: property.id, currency: property.currency }, 'Excluded comparable with unusable currency rate')
      return null
    }
  }

  function applyRecencyFilter(rows, matchConfig, dateFields) {
    if (!matchConfig.max_days_since_listed) return rows
    const cutoff = Date.now() - Number(matchConfig.max_days_since_listed) * 24 * 60 * 60 * 1000
    return rows.filter((row) => {
      const raw = dateFields.map((field) => row[field]).find(Boolean)
      if (!raw) return false
      const timestamp = new Date(raw).getTime()
      return Number.isFinite(timestamp) && timestamp >= cutoff
    })
  }

  function applyRuleAdjustment(price, rules, ruleType, value) {
    const rule = rules.find((r) => r.rule_type === ruleType && String(r.value).toLowerCase() === String(value || 'unknown').toLowerCase())
    if (!rule) return price
    return price * (1 + Number(rule.adjustment_percent) / 100)
  }

  async function resolveAreaForProperty(property) {
    if (!property) return null
    const areas = await adapter.getAreaProfiles({ status: 'scoring_enabled' })
    const names = [property.city, property.neighborhood, property.location].filter(Boolean).map((n) => String(n).toLowerCase())
    return areas.find((a) => {
      const keys = [a.slug, a.name, a.name_ar].filter(Boolean).map((k) => String(k).toLowerCase())
      return names.some((n) => keys.includes(n))
    }) || null
  }

  function sameAreaOrNearby(p, target, area, radiusMeters) {
    const pNames = [p.city, p.neighborhood, p.location].filter(Boolean).map((n) => String(n).toLowerCase())
    const tNames = [target.city, target.neighborhood, target.location].filter(Boolean).map((n) => String(n).toLowerCase())
    if (pNames.some((n) => tNames.includes(n))) return true

    if (area && area.center_latitude != null && area.center_longitude != null) {
      const pLat = Number(p.latitude)
      const pLon = Number(p.longitude)
      if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return false
      const dist = haversineKm(area.center_latitude, area.center_longitude, pLat, pLon) * 1000
      return dist <= (radiusMeters || 5000)
    }
    return false
  }

  function sameAreaName(externalComparable, area) {
    const names = [area.name, area.name_ar, area.slug].filter(Boolean).map((n) => String(n).toLowerCase())
    const ecName = externalComparable.location_text ? String(externalComparable.location_text).toLowerCase() : ''
    return names.some((n) => ecName.includes(n))
  }

  function matchesNumericFilters(p, target, matchConfig) {
    if (target.bedrooms != null && p.bedrooms != null) {
      const range = matchConfig.bed_range ?? 1
      if (Math.abs(Number(p.bedrooms) - Number(target.bedrooms)) > range) return false
    }
    if (target.bathrooms != null && p.bathrooms != null) {
      const range = matchConfig.bath_range ?? 1
      if (Math.abs(Number(p.bathrooms) - Number(target.bathrooms)) > range) return false
    }
    if (target.area != null && p.area != null && matchConfig.area_range_percent != null) {
      const pct = matchConfig.area_range_percent / 100
      const delta = Number(target.area) * pct
      if (Math.abs(Number(p.area) - Number(target.area)) > delta) return false
    }
    if (target.building_age_years != null && p.building_age_years != null && matchConfig.age_range_years != null) {
      if (Math.abs(Number(p.building_age_years) - Number(target.building_age_years)) > matchConfig.age_range_years) return false
    }
    return true
  }

  function matchesNumericFiltersExternal(ec, target, matchConfig) {
    if (target.bedrooms != null && ec.bedrooms != null) {
      const range = matchConfig.bed_range ?? 1
      if (Math.abs(Number(ec.bedrooms) - Number(target.bedrooms)) > range) return false
    }
    if (target.bathrooms != null && ec.bathrooms != null) {
      const range = matchConfig.bath_range ?? 1
      if (Math.abs(Number(ec.bathrooms) - Number(target.bathrooms)) > range) return false
    }
    if (target.area != null && ec.area_sqm != null && matchConfig.area_range_percent != null) {
      const pct = matchConfig.area_range_percent / 100
      const delta = Number(target.area) * pct
      if (Math.abs(Number(ec.area_sqm) - Number(target.area)) > delta) return false
    }
    if (target.building_age_years != null && ec.building_age_years != null && matchConfig.age_range_years != null) {
      if (Math.abs(Number(ec.building_age_years) - Number(target.building_age_years)) > matchConfig.age_range_years) return false
    }
    return true
  }

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return 0
    const index = (p / 100) * (sortedValues.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    if (lower === upper) return sortedValues[lower]
    const weight = index - lower
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (x) => (x * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return 6371 * c
  }

  return {
    findComparables,
    normalizePropertyPrice,
    resolveAreaForProperty,
  }
}
