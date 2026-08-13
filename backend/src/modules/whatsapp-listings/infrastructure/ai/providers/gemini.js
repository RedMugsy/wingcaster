import {
  cleanJsonResponse,
  fetchImageAsBase64,
  createTimeoutSignal,
} from '../shared.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'gemini-1.5-flash'

export function createProvider({ apiKey, logger }) {
  if (!apiKey) throw new Error('Gemini API key is required')

  async function callApi({ prompt, images = [] }) {
    const imageParts = await Promise.all(
      images.map(async (img) => {
        const { mimeType, data } = await fetchImageAsBase64(img.url, img.mimeType)
        return { inlineData: { mimeType, data } }
      })
    )

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, ...imageParts],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }

    const { signal, clear } = createTimeoutSignal(30000)
    try {
      const res = await fetch(
        `${API_BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }
      )
      clear()

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Gemini API error ${res.status}: ${text}`)
      }

      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new Error('Gemini response missing content')
      return { text: cleanJsonResponse(text), raw: data }
    } finally {
      clear()
    }
  }

  async function extractProperty({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'Gemini extractProperty request')
    return callApi({ prompt, images })
  }

  async function classifyIntent({ messages, images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'Gemini classifyIntent request')
    return callApi({ prompt, images })
  }

  async function generateCaption({ platform, property, variant, prompt }) {
    logger.debug({ platform }, 'Gemini generateCaption request')
    return callApi({ prompt, images: [] })
  }

  async function selectBestTemplate({ imageDescriptions, prompt }) {
    logger.debug('Gemini selectBestTemplate request')
    return callApi({ prompt, images: [] })
  }

  async function selectHeroImage({ images, prompt }) {
    logger.debug({ imageCount: images?.length }, 'Gemini selectHeroImage request')
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
