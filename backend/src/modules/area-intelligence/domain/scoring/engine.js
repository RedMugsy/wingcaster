import { ScoringLogic } from '../types.js'
import { weightedAverage } from './weighted-average.js'
import { conditionalRules } from './conditional-rules.js'
import { aiSynthesis } from './ai-synthesis.js'
import { compositeScore } from './composite.js'
import { manualOnly } from './manual-only.js'

export function createScoringEngine({ config, logger }) {
  async function calculate({ dimension, signals = [], submissions = [], areaScores = [], area, aiConfig }) {
    const logicConfig = typeof dimension.scoring_logic_config === 'string'
      ? JSON.parse(dimension.scoring_logic_config || '{}')
      : dimension.scoring_logic_config || {}

    const logic = logicConfig.logic || ScoringLogic.WEIGHTED_AVERAGE

    const ctx = { dimension, signals, submissions, areaScores, area, aiConfig, config, logger }

    switch (logic) {
      case ScoringLogic.WEIGHTED_AVERAGE:
        return weightedAverage(ctx)
      case ScoringLogic.CONDITIONAL_RULES:
        return conditionalRules(ctx)
      case ScoringLogic.AI_SYNTHESIS:
        return aiSynthesis(ctx)
      case ScoringLogic.COMPOSITE:
        return compositeScore(ctx)
      case ScoringLogic.MANUAL_ONLY:
        return manualOnly(ctx)
      default:
        return {
          score: null,
          confidence: 0,
          rationale: `Unknown scoring logic "${logic}" for ${dimension.name}`,
          inputSignals: [],
        }
    }
  }

  return { calculate }
}
