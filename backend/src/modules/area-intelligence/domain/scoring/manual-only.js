export async function manualOnly({ dimension, submissions, logger }) {
  const approved = (submissions || []).filter((s) => s.status === 'approved')
  const scores = approved
    .map((s) => {
      const dimensionScores = typeof s.dimension_scores === 'string'
        ? JSON.parse(s.dimension_scores || '{}')
        : s.dimension_scores || {}
      return Number(dimensionScores[dimension.slug])
    })
    .filter((v) => Number.isFinite(v))

  if (!scores.length) {
    return {
      score: null,
      confidence: 0,
      rationale: `No approved field inspection scores for ${dimension.name}`,
      inputSignals: [],
    }
  }

  const average = scores.reduce((a, b) => a + b, 0) / scores.length
  return {
    score: Math.round(average * 10) / 10,
    confidence: Math.min(scores.length / 3, 1),
    rationale: `Average of ${scores.length} approved field inspection score(s) for ${dimension.name}`,
    inputSignals: approved.map((s) => s.id),
    inputFormula: { average, count: scores.length },
  }
}
