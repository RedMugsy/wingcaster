import {
  cleanJsonResponse,
  fetchImageAsBase64,
  createTimeoutSignal,
} from '../shared.js'

const API_BASE = 'https://api.openai.com/v1'
const MODEL = 'gpt-4o-mini'

export function createProvider({ apiKey, logger }) {
  if (!apiKey) throw new Error('OpenAI API key is required')

  async function callApi({ prompt, images = [], jsonMode = true }) {
    const imageContents = await Promise.all(
      images.map(async (img) => {
        const { mimeType, data } = await fetchImageAsBase64(img.url, img.mimeType)
        return {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${data}` },
        }
      })
    )

    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant that always returns JSON responses.',
      },
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }, ...imageContents],
      },
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
      const res = await fetch(`${API_BASE}/chat/completions`, {
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
        throw new Error(`OpenAI API error ${res.status}: ${text}`)
      }

      const data = await res.json()
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error('OpenAI response missing content')
      return { text: cleanJsonResponse(text), raw: data }
    } finally {
      clear()
    }
  }

  async function extractProperty({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'OpenAI extractProperty request')
    return callApi({ prompt, images, jsonMode: true })
  }

  async function classifyIntent({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'OpenAI classifyIntent request')
    return callApi({ prompt, images, jsonMode: true })
  }

  async function generateCaption({ platform, property, variant, prompt }) {
    logger.debug({ platform }, 'OpenAI generateCaption request')
    return callApi({ prompt, images: [], jsonMode: true })
  }

  async function selectBestTemplate({ imageDescriptions, prompt }) {
    logger.debug('OpenAI selectBestTemplate request')
    return callApi({ prompt, images: [], jsonMode: true })
  }

  async function selectHeroImage({ images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'OpenAI selectHeroImage request')
    return callApi({ prompt, images })
  }

  async function healthCheck() {
    try {
      await callApi({ prompt: 'Return {"ok": true} as JSON.', images: [], jsonMode: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }

  return { extractProperty, classifyIntent, generateCaption, selectBestTemplate, selectHeroImage, healthCheck }
}
