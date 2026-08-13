export async function conditionalRules({ dimension, signals, logger }) {
  const config = typeof dimension.scoring_logic_config === 'string'
    ? JSON.parse(dimension.scoring_logic_config || '{}')
    : dimension.scoring_logic_config || {}
  const rules = Array.isArray(config.rules) ? config.rules : []

  if (!rules.length) {
    return {
      score: null,
      confidence: 0,
      rationale: `No conditional rules configured for ${dimension.name}`,
      inputSignals: [],
    }
  }

  let matchedScore = null
  let matchedRule = null

  for (const signal of signals || []) {
    const features = typeof signal.extracted_features === 'string'
      ? JSON.parse(signal.extracted_features || '{}')
      : signal.extracted_features || {}

    for (const rule of rules) {
      if (evaluateCondition(rule.condition, features)) {
        matchedScore = Number(rule.score)
        matchedRule = rule
        break
      }
    }
    if (matchedRule) break
  }

  if (matchedRule) {
    return {
      score: Math.min(10, Math.max(0, matchedScore)),
      confidence: 0.7,
      rationale: `Matched rule: ${matchedRule.name || matchedRule.condition}`,
      inputSignals: (signals || []).map((s) => s.id),
      inputFormula: { matchedRule },
    }
  }

  return {
    score: null,
    confidence: 0,
    rationale: `No conditional rules matched for ${dimension.name}`,
    inputSignals: (signals || []).map((s) => s.id),
  }
}

function evaluateCondition(condition, features) {
  if (!condition) return true
  const value = features[condition.field]
  switch (condition.operator) {
    case 'eq':
      return value === condition.value
    case 'neq':
      return value !== condition.value
    case 'gt':
      return Number(value) > Number(condition.value)
    case 'gte':
      return Number(value) >= Number(condition.value)
    case 'lt':
      return Number(value) < Number(condition.value)
    case 'lte':
      return Number(value) <= Number(condition.value)
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(value)
    default:
      return false
  }
}
