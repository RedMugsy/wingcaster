import { createAiAdapter as createWhatsAppAiAdapter } from '../../../whatsapp-listings/infrastructure/ai/adapter.js'

export async function aiSynthesis({ dimension, signals, area, aiConfig, config, logger }) {
  const cfg = aiConfig || {}
  const promptConfig = {
    provider: cfg.provider || config.aiProvider || 'gemini',
    model: cfg.model || 'gemini-1.5-flash',
    fallbackAiProviders: [],
    temperature: cfg.temperature ?? 0.3,
    maxTokens: cfg.max_tokens ?? 2048,
  }

  const aiAdapter = createWhatsAppAiAdapter({ config: promptConfig, logger })

  const signalSummaries = (signals || []).map((s) => {
    const features = typeof s.extracted_features === 'string'
      ? JSON.parse(s.extracted_features || '{}')
      : s.extracted_features || {}
    return {
      signal_type: s.signal_type,
      raw_content: (s.raw_content || '').slice(0, 500),
      extracted_features: features,
    }
  })

  const systemPrompt = cfg.system_prompt || 'You are a location analyst. Respond with JSON only.'
  const template = cfg.scoring_prompt_template || 'Analyze signals for {{area_name}} and return a JSON score.'
  const outputSchema = typeof cfg.output_schema === 'string'
    ? JSON.parse(cfg.output_schema || '{}')
    : cfg.output_schema || {
        type: 'object',
        properties: {
          score: { type: 'number' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
          summary: { type: 'string' },
          summary_ar: { type: 'string' },
        },
        required: ['score', 'confidence', 'rationale'],
      }

  const userPrompt = template
    .replace('{{area_name}}', area.name || '')
    .replace('{{area_level}}', area.level || '')
    .replace('{{dimension_name}}', dimension.name || '')
    .replace('{{signals_json}}', JSON.stringify(signalSummaries, null, 2))
    .replace('{{task_instructions}}', `Score ${dimension.name} on a scale of 0-10. Provide confidence 0-1, rationale, summary, and Arabic summary. Return valid JSON only.`)

  try {
    const result = await aiAdapter.complete({
      systemPrompt,
      userPrompt,
      outputSchema,
      operation: 'area_score_ai_synthesis',
    })

    const parsed = result?.content ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : result
    const score = Math.min(10, Math.max(0, Number(parsed?.score)))
    const confidence = Math.min(1, Math.max(0, Number(parsed?.confidence)))

    return {
      score: Number.isFinite(score) ? score : null,
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      rationale: parsed?.rationale || `AI synthesis for ${dimension.name}`,
      summary: parsed?.summary || null,
      summary_ar: parsed?.summary_ar || null,
      inputSignals: signalSummaries.map((_, i) => (signals || [])[i]?.id).filter(Boolean),
      inputFormula: { provider: result?.provider, model: result?.model },
    }
  } catch (err) {
    logger.error({ err: err.message, dimension: dimension.slug, area: area.slug }, 'AI synthesis scoring failed')
    return {
      score: null,
      confidence: 0,
      rationale: `AI synthesis failed for ${dimension.name}: ${err.message}`,
      inputSignals: (signals || []).map((s) => s.id),
    }
  }
}
