import { v4 as uuidv4 } from 'uuid'
import { Collections } from '../infrastructure/db.js'

export function createTrendService({ dal, adapter, currencyService, config, logger }) {
  async function snapshotArea(areaId, propertyType, year, quarter) {
    const area = await adapter.getAreaById(areaId)
    if (!area) throw new Error('Area not found')

    const properties = await adapter.getProperties({ status: 'active', property_type: propertyType })
    const quarterEnd = endOfQuarter(year, quarter)
    const areaProperties = properties.filter((p) => {
      if (!sameAreaOrNearby(p, area)) return false
      const listedAt = p.created_at || p.listed_date
      return !listedAt || new Date(listedAt) <= quarterEnd
    })

    const normalizedPrices = []
    const perSqmPrices = []
    for (const p of areaProperties) {
      const norm = await currencyService.normalizeToUsd(Number(p.price), p.currency || config.baseCurrency)
      if (norm.amount > 0) {
        normalizedPrices.push(norm.amount)
        if (p.area > 0) perSqmPrices.push(norm.amount / Number(p.area))
      }
    }

    const stats = {
      median_price: median(normalizedPrices),
      mean_price: mean(normalizedPrices),
      median_price_per_sqm: median(perSqmPrices),
      mean_price_per_sqm: mean(perSqmPrices),
      properties_count: areaProperties.length,
      new_listings_count: areaProperties.filter((p) => isNewListing(p)).length,
    }

    // Compute changes from previous quarter and previous year
    const previous = previousQuarter(year, quarter)
    const prevQuarter = await findSnapshot(areaId, propertyType, previous.year, previous.quarter)
    const prevYear = await findSnapshot(areaId, propertyType, year - 1, quarter)
    const prev24Months = await findSnapshot(areaId, propertyType, year - 2, quarter)
    const recent = await getTrends(areaId, propertyType)
    const recentChanges = recent.slice(-7).map((snapshot) => Number(snapshot.change_from_prev_quarter_percent)).filter(Number.isFinite)
    const quarterChange = computeChange(stats.median_price, prevQuarter?.median_price)
    const confidence = trendConfidence(stats.properties_count)

    const row = {
      id: uuidv4(),
      area_id: areaId,
      property_type: propertyType,
      year,
      quarter,
      ...stats,
      change_from_prev_quarter_percent: quarterChange,
      change_from_prev_year_percent: computeChange(stats.median_price, prevYear?.median_price),
      change_24_month_percent: computeChange(stats.median_price, prev24Months?.median_price),
      trend_direction: classifyDirection(quarterChange),
      volatility_percent: standardDeviation([...recentChanges, quarterChange].filter(Number.isFinite)),
      confidence: confidence.level,
      confidence_reason: confidence.reason,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      data: { property_ids: areaProperties.map((p) => p.id) },
    }

    const existing = await dal.findOne(
      Collections.PRICE_TREND_SNAPSHOTS,
      (s) => s.area_id === areaId && s.property_type === propertyType && s.year === year && s.quarter === quarter
    )
    if (existing) {
      await dal.update(Collections.PRICE_TREND_SNAPSHOTS, (s) => s.id === existing.id, () => row)
    } else {
      await dal.insert(Collections.PRICE_TREND_SNAPSHOTS, row)
    }

    return row
  }

  async function findSnapshot(areaId, propertyType, year, quarter) {
    if (!year || !quarter) return null
    return dal.findOne(
      Collections.PRICE_TREND_SNAPSHOTS,
      (s) => s.area_id === areaId && s.property_type === propertyType && s.year === year && s.quarter === quarter
    )
  }

  async function getTrends(areaId, propertyType) {
    const rows = await dal.findAll(
      Collections.PRICE_TREND_SNAPSHOTS,
      (s) => s.area_id === areaId && s.property_type === propertyType
    )
    return rows.sort((a, b) => a.year - b.year || a.quarter - b.quarter)
  }

  async function runAllSnapshots() {
    const now = new Date()
    const year = now.getFullYear()
    const quarter = Math.floor(now.getMonth() / 3) + 1
    const areas = await adapter.getAreaProfiles({ status: 'scoring_enabled' })
    const propertyTypes = await distinctPropertyTypes()
    let created = 0

    for (const area of areas) {
      for (const propertyType of propertyTypes) {
        for (const period of lastNQuarters(year, quarter, 8)) {
          try {
            await snapshotArea(area.id, propertyType, period.year, period.quarter)
            created++
          } catch (err) {
            logger.warn({ err: err.message, areaId: area.id, propertyType, period }, 'Trend snapshot failed')
          }
        }
      }
    }

    return { created }
  }

  async function distinctPropertyTypes() {
    const properties = await adapter.getProperties({ status: 'active' })
    return [...new Set(properties.map((p) => p.property_type).filter(Boolean))]
  }

  async function getAdminTrendDashboard() {
    const rows = await dal.findAll(Collections.PRICE_TREND_SNAPSHOTS, () => true)
    const alerts = rows.filter(
      (r) => Math.abs(Number(r.change_from_prev_quarter_percent) || 0) > 10
    )
    return { snapshots: rows, alerts }
  }

  function sameAreaOrNearby(property, area) {
    const names = [property.city, property.neighborhood, property.location].filter(Boolean).map((n) => String(n).toLowerCase())
    const areaNames = [area.name, area.name_ar, area.slug].filter(Boolean).map((n) => String(n).toLowerCase())
    if (names.some((n) => areaNames.includes(n))) return true

    if (area.center_latitude != null && area.center_longitude != null && property.latitude != null && property.longitude != null) {
      const dist = haversineKm(area.center_latitude, area.center_longitude, property.latitude, property.longitude) * 1000
      return dist <= 5000
    }
    return false
  }

  function isNewListing(property) {
    const created = property.created_at ? new Date(property.created_at) : null
    if (!created) return false
    const days = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)
    return days <= 90
  }

  function computeChange(current, previous) {
    if (!current || !previous || Number(previous) === 0) return null
    return Number((((current - previous) / previous) * 100).toFixed(2))
  }

  function previousQuarter(year, quarter) {
    return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 }
  }

  function lastNQuarters(year, quarter, count) {
    const periods = []
    let current = { year, quarter }
    for (let index = 0; index < count; index++) {
      periods.unshift(current)
      current = previousQuarter(current.year, current.quarter)
    }
    return periods
  }

  function endOfQuarter(year, quarter) {
    return new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999))
  }

  function classifyDirection(change) {
    if (change == null) return 'insufficient_data'
    if (change > 2) return 'rising'
    if (change < -2) return 'falling'
    return 'stable'
  }

  function trendConfidence(count) {
    if (count >= 20) return { level: 'high', reason: `Based on ${count} listings in the quarter.` }
    if (count >= 8) return { level: 'medium', reason: `Based on ${count} listings; interpret the trend with some caution.` }
    return { level: 'low', reason: `Only ${count} listing${count === 1 ? '' : 's'} contributed to this quarter.` }
  }

  function standardDeviation(values) {
    if (values.length < 2) return null
    const average = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
    return Number(Math.sqrt(variance).toFixed(2))
  }

  function median(values) {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
  }

  function mean(values) {
    if (!values.length) return null
    return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
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
    snapshotArea,
    getTrends,
    runAllSnapshots,
    getAdminTrendDashboard,
  }
}
