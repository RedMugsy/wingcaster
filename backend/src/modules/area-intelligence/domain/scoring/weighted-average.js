export async function weightedAverage({ dimension, signals, logger }) {
  if (!signals?.length) {
    return {
      score: null,
      confidence: 0,
      rationale: `No signals available for ${dimension.name}`,
      inputSignals: [],
    }
  }

  const values = []
  let totalWeight = 0
  let weightedSum = 0

  for (const signal of signals) {
    const features = typeof signal.extracted_features === 'string'
      ? JSON.parse(signal.extracted_features || '{}')
      : signal.extracted_features || {}
    const value = Number(features.value)
    const weight = Number(features.weight ?? 1)
    const max = Number(features.max ?? 10)
    if (Number.isFinite(value) && Number.isFinite(weight) && weight > 0 && max > 0) {
      const normalized = (value / max) * 10
      values.push({ signalId: signal.id, value, normalized, weight, max })
      weightedSum += normalized * weight
      totalWeight += weight
    }
  }

  if (!values.length || totalWeight === 0) {
    return {
      score: null,
      confidence: 0,
      rationale: `Signals for ${dimension.name} did not contain usable numeric values`,
      inputSignals: signals.map((s) => s.id),
    }
  }

  const score = weightedSum / totalWeight
  const confidence = Math.min(values.length / 5, 1) // More signals → higher confidence, cap at 1

  return {
    score: Math.round(score * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    rationale: `Weighted average of ${values.length} signal(s) for ${dimension.name}`,
    inputSignals: values,
    inputFormula: { weightedAverage: values },
  }
}
