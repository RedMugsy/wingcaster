import {
  cleanJsonResponse,
  fetchImageAsBase64,
  createTimeoutSignal,
} from '../shared.js'

const API_BASE = 'https://api.anthropic.com/v1'
const MODEL = 'claude-3-haiku-20240307'

export function createProvider({ apiKey, logger }) {
  if (!apiKey) throw new Error('Claude API key is required')

  async function callApi({ prompt, images = [] }) {
    const imageBlocks = await Promise.all(
      images.map(async (img) => {
        const { mimeType, data } = await fetchImageAsBase64(img.url, img.mimeType)
        return {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data },
        }
      })
    )

    const body = {
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageBlocks],
        },
      ],
    }

    const { signal, clear } = createTimeoutSignal(30000)
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      })
      clear()

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Claude API error ${res.status}: ${text}`)
      }

      const data = await res.json()
      const text = data.content?.[0]?.text
      if (!text) throw new Error('Claude response missing content')
      return { text: cleanJsonResponse(text), raw: data }
    } finally {
      clear()
    }
  }

  async function extractProperty({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'Claude extractProperty request')
    return callApi({ prompt, images })
  }

  async function classifyIntent({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'Claude classifyIntent request')
    return callApi({ prompt, images })
  }

  async function generateCaption({ platform, property, variant, prompt }) {
    logger.debug({ platform }, 'Claude generateCaption request')
    return callApi({ prompt, images: [] })
  }

  async function selectBestTemplate({ imageDescriptions, prompt }) {
    logger.debug('Claude selectBestTemplate request')
    return callApi({ prompt, images: [] })
  }

  async function selectHeroImage({ images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'Claude selectHeroImage request')
    return callApi({ prompt, images })
  }

  async function healthCheck() {
    try {
      await callApi({ prompt: 'Return {"ok": true} as JSON.', images: [] })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  return { extractProperty, classifyIntent, generateCaption, selectBestTemplate, selectHeroImage, healthCheck }
}
