import { describe, it, expect } from 'vitest'
import { createScoringEngine } from '../domain/scoring/engine.js'

const logger = { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} }
const engine = createScoringEngine({ config: {}, logger })

function dim(overrides = {}) {
  return {
    id: 'dim-1',
    name: 'Test Dimension',
    slug: 'test_dimension',
    display_config: {},
    scoring_logic_config: { logic: 'weighted_average' },
    ...overrides,
  }
}

function signal(value, weight = 1, max = 10) {
  return {
    id: `sig-${value}`,
    extracted_features: { value, weight, max },
  }
}

describe('Scoring Engine', () => {
  it('weighted_average computes normalized score', async () => {
    const result = await engine.calculate({
      dimension: dim(),
      signals: [signal(5), signal(10)],
      area: { name: 'Test' },
    })
    expect(result.score).toBe(7.5)
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('weighted_average returns null when no usable signals', async () => {
    const result = await engine.calculate({
      dimension: dim(),
      signals: [{ id: 's1', extracted_features: {} }],
      area: { name: 'Test' },
    })
    expect(result.score).toBeNull()
  })

  it('composite sums component scores', async () => {
    const result = await engine.calculate({
      dimension: dim({
        scoring_logic_config: {
          logic: 'composite',
          components: [
            { dimension_slug: 'a', weight: 0.5 },
            { dimension_slug: 'b', weight: 0.5 },
          ],
        },
      }),
      areaScores: [
        { dimension_slug: 'a', score_value: 6 },
        { dimension_slug: 'b', score_value: 8 },
      ],
      area: { name: 'Test' },
    })
    expect(result.score).toBe(7)
  })

  it('manual_only averages approved inspection submissions', async () => {
    const result = await engine.calculate({
      dimension: dim({ scoring_logic_config: { logic: 'manual_only' } }),
      submissions: [
        { id: 'sub-1', status: 'approved', dimension_scores: { test_dimension: 8 } },
        { id: 'sub-2', status: 'approved', dimension_scores: { test_dimension: 6 } },
        { id: 'sub-3', status: 'pending_review', dimension_scores: { test_dimension: 10 } },
      ],
      area: { name: 'Test' },
    })
    expect(result.score).toBe(7)
  })

  it('conditional_rules matches first true condition', async () => {
    const result = await engine.calculate({
      dimension: dim({
        scoring_logic_config: {
          logic: 'conditional_rules',
          rules: [
            { name: 'high', condition: { field: 'count', operator: 'gte', value: 5 }, score: 9 },
            { name: 'low', condition: { field: 'count', operator: 'lt', value: 5 }, score: 3 },
          ],
        },
      }),
      signals: [{ id: 's1', extracted_features: { count: 2 } }],
      area: { name: 'Test' },
    })
    expect(result.score).toBe(3)
  })
})
