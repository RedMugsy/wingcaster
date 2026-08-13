export async function compositeScore({ dimension, areaScores, logger }) {
  const config = typeof dimension.scoring_logic_config === 'string'
    ? JSON.parse(dimension.scoring_logic_config || '{}')
    : dimension.scoring_logic_config || {}
  const components = Array.isArray(config.components) ? config.components : []

  if (!components.length) {
    return {
      score: null,
      confidence: 0,
      rationale: `No components configured for composite dimension ${dimension.name}`,
      inputFormula: { components: [] },
    }
  }

  let weightedSum = 0
  let totalWeight = 0
  let missing = []
  const used = []

  for (const component of components) {
    const match = areaScores.find((s) =>
      (component.dimension_slug && s.dimension_slug === component.dimension_slug) ||
      (component.dimension_id && s.dimension_id === component.dimension_id)
    )
    const score = Number(match?.score_value)
    const weight = Number(component.weight)
    if (Number.isFinite(score) && Number.isFinite(weight) && weight > 0) {
      weightedSum += score * weight
      totalWeight += weight
      used.push({ dimension_slug: component.dimension_slug, score, weight })
    } else {
      missing.push(component.dimension_slug || component.dimension_id)
    }
  }

  if (!used.length || totalWeight === 0) {
    return {
      score: null,
      confidence: 0,
      rationale: `No component scores available for composite dimension ${dimension.name}. Missing: ${missing.join(', ') || 'all'}`,
      inputFormula: { components, missing },
    }
  }

  const score = weightedSum / totalWeight
  const confidence = used.length / components.length

  return {
    score: Math.round(score * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    rationale: `Composite score for ${dimension.name} from ${used.length}/${components.length} components`,
    inputFormula: { weightedComponents: used },
  }
}
