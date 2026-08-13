import {
  cleanJsonResponse,
  createTimeoutSignal,
} from '../shared.js'

const API_BASE = 'https://api.deepseek.com'
const MODEL = 'deepseek-chat'

/**
 * DeepSeek chat completions adapter.
 *
 * DeepSeek's chat endpoint is text-only, so images are ignored at the API
 * layer. If vision is needed, callers should rely on providers that support it
 * or fall back to image descriptions already embedded in the prompt text.
 */
export function createProvider({ apiKey, logger }) {
  if (!apiKey) throw new Error('DeepSeek API key is required')

  async function callApi({ prompt, jsonMode = true }) {
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant that always returns JSON responses.',
      },
      { role: 'user', content: prompt },
    ]

    const body = {
      model: MODEL,
      messages,
      max_tokens: 2048,
      temperature: 0.2,
    }

    if (jsonMode) {
      body.response_format = { type: 'json_object' }
    }

    const { signal, clear } = createTimeoutSignal(30000)
    try {
      const res = await fetch(`${API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      })
      clear()

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`DeepSeek API error ${res.status}: ${text}`)
      }

      const data = await res.json()
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error('DeepSeek response missing content')
      return { text: cleanJsonResponse(text), raw: data }
    } finally {
      clear()
    }
  }

  async function extractProperty({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'DeepSeek extractProperty request (vision not supported)')
    return callApi({ prompt, jsonMode: true })
  }

  async function classifyIntent({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'DeepSeek classifyIntent request (vision not supported)')
    return callApi({ prompt, jsonMode: true })
  }

  async function generateCaption({ platform, property, variant, prompt }) {
    logger.debug({ platform }, 'DeepSeek generateCaption request')
    return callApi({ prompt, jsonMode: true })
  }

  async function selectBestTemplate({ imageDescriptions, prompt }) {
    logger.debug('DeepSeek selectBestTemplate request')
    return callApi({ prompt, jsonMode: true })
  }

  async function selectHeroImage({ images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'DeepSeek selectHeroImage request (vision not supported)')
    return callApi({ prompt, jsonMode: true })
  }

  async function healthCheck() {
    try {
      await callApi({ prompt: 'Return {"ok": true} as JSON.', jsonMode: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  return { extractProperty, classifyIntent, generateCaption, selectBestTemplate, selectHeroImage, healthCheck }
}
