import { v4 as uuidv4 } from 'uuid'
import { findAllModule, findOneModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'
import { createScoringEngine } from '../domain/scoring/engine.js'

export function createScoreService({ adapter, config, logger }) {
  const engine = createScoringEngine({ config, logger })
  async function listForArea(areaId) {
    return findAllModule('area_score_calculations', (c) => c.area_id === areaId)
  }

  async function getLatestForDimension(areaId, dimensionId) {
    const rows = await findAllModule('area_score_calculations', (c) => c.area_id === areaId && c.dimension_id === dimensionId)
    if (!rows.length) return null
    return rows.sort((a, b) => new Date(b.calculated_at).getTime() - new Date(a.calculated_at).getTime())[0]
  }

  async function getCurrentScores(areaId) {
    const rows = await findAllModule('area_score_calculations', (c) => c.area_id === areaId)
    const latest = new Map()
    for (const row of rows) {
      const existing = latest.get(row.dimension_id)
      if (!existing || new Date(row.calculated_at) > new Date(existing.calculated_at)) {
        latest.set(row.dimension_id, row)
      }
    }
    return Array.from(latest.values())
  }

  async function recordScore({ areaId, dimensionId, method, inputSignals, inputFormula, score, rationale, confidence, isManualOverride, overriddenBy, overrideReason }) {
    const now = new Date().toISOString()
    return insertModule('area_score_calculations', {
      id: uuidv4(),
      area_id: areaId,
      dimension_id: dimensionId,
      calculation_method: method,
      input_signals: inputSignals ? JSON.stringify(inputSignals) : null,
      input_formula: inputFormula ? JSON.stringify(inputFormula) : null,
      score_value: score ?? null,
      score_rationale: rationale || null,
      confidence: confidence ?? null,
      is_manual_override: isManualOverride || false,
      overridden_by: overriddenBy || null,
      override_reason: overrideReason || null,
      calculated_at: now,
      created_at: now,
      updated_at: now,
    })
  }

  async function manualOverride({ areaId, dimensionId, score, rationale, overriddenBy, reason }) {
    return recordScore({
      areaId,
      dimensionId,
      method: 'manual_override',
      score,
      rationale,
      confidence: 1.0,
      isManualOverride: true,
      overriddenBy,
      overrideReason: reason,
    })
  }

  async function removeHistory(id) {
    return removeModule('area_score_calculations', (c) => c.id === id)
  }

  async function calculateForArea(area, dimensions, { signals = [], submissions = [], aiConfig }) {
    const currentScores = await getCurrentScores(area.id)
    const results = []

    // First pass: non-composite dimensions.
    const nonComposite = dimensions.filter((d) => {
      const cfg = typeof d.scoring_logic_config === 'string'
        ? JSON.parse(d.scoring_logic_config || '{}')
        : d.scoring_logic_config || {}
      return cfg.logic !== 'composite'
    })

    for (const dimension of nonComposite) {
      const dimensionSignals = signals.filter((s) => {
        // Match by dimension slug in signal features if present, otherwise include all signals for weighted/manual.
        const features = typeof s.extracted_features === 'string'
          ? JSON.parse(s.extracted_features || '{}')
          : s.extracted_features || {}
        return !features.dimension_slug || features.dimension_slug === dimension.slug
      })
      const dimensionSubmissions = submissions.filter((s) => {
        const scores = typeof s.dimension_scores === 'string'
          ? JSON.parse(s.dimension_scores || '{}')
          : s.dimension_scores || {}
        return dimension.slug in scores
      })
      const result = await engine.calculate({
        dimension,
        signals: dimensionSignals,
        submissions: dimensionSubmissions,
        areaScores: currentScores,
        area,
        aiConfig,
      })
      const recorded = await recordScore({
        areaId: area.id,
        dimensionId: dimension.id,
        method: JSON.parse(dimension.scoring_logic_config || '{}').logic || 'weighted_average',
        inputSignals: result.inputSignals,
        inputFormula: result.inputFormula,
        score: result.score,
        rationale: result.rationale,
        confidence: result.confidence,
      })
      results.push({ dimension, ...recorded })
    }

    // Second pass: composite dimensions need non-composite results first.
    const composite = dimensions.filter((d) => {
      const cfg = typeof d.scoring_logic_config === 'string'
        ? JSON.parse(d.scoring_logic_config || '{}')
        : d.scoring_logic_config || {}
      return cfg.logic === 'composite'
    })

    const updatedScores = await getCurrentScores(area.id)
    for (const dimension of composite) {
      const enrichedScores = updatedScores.map((s) => ({
        dimension_id: s.dimension_id,
        dimension_slug: dimensions.find((d) => d.id === s.dimension_id)?.slug,
        score_value: s.score_value,
      }))
      const result = await engine.calculate({
        dimension,
        signals: [],
        submissions: [],
        areaScores: enrichedScores,
        area,
      })
      const recorded = await recordScore({
        areaId: area.id,
        dimensionId: dimension.id,
        method: 'composite',
        inputSignals: result.inputSignals,
        inputFormula: result.inputFormula,
        score: result.score,
        rationale: result.rationale,
        confidence: result.confidence,
      })
      results.push({ dimension, ...recorded })
    }

    return results
  }

  return {
    listForArea,
    getLatestForDimension,
    getCurrentScores,
    recordScore,
    manualOverride,
    removeHistory,
    calculateForArea,
  }
}
