import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerListingsAiRoutes } from './routes.js'

function createHarness(extractProperty) {
  const calls = []
  const app = express()
  app.use(express.json())
  registerListingsAiRoutes(app, {
    aiAdapter: {
      extractProperty: vi.fn(async (input) => {
        calls.push({ type: 'adapter', input })
        return await extractProperty(input)
      }),
    },
    config: { maxPhotos: 10 },
    logger: { info: vi.fn(), warn: vi.fn() },
    authMiddleware: (req, _res, next) => {
      req.user = { id: 'tenant-1' }
      next()
    },
    emitUsageEventAsync: vi.fn((event) => calls.push({ type: 'emit', event })),
  })
  return { app, calls }
}

describe('POST /api/listings-ai/describe metering', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not meter invalid requests', async () => {
    const { app, calls } = createHarness(vi.fn())

    await request(app).post('/api/listings-ai/describe').send({ photo_urls: [] }).expect(400)

    expect(calls).toEqual([])
  })

  it('meters one generated description after provider success', async () => {
    const { app, calls } = createHarness(async () => ({
      provider: 'openai',
      property: { title: 'Home', confidence: 0.9 },
    }))

    await request(app)
      .post('/api/listings-ai/describe')
      .send({ photo_urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'] })
      .expect(200)

    expect(calls.map((call) => call.type)).toEqual(['adapter', 'emit'])
    expect(calls[1].event).toMatchObject({
      actionKey: 'ai.description.generated',
      tenantId: 'tenant-1',
      quantity: 1,
      metadata: {
        provider: 'openai',
        photo_count: 2,
        ai_success: true,
      },
    })
    expect(calls[1].event.metadata.ai_duration_ms).toEqual(expect.any(Number))
  })

  it('meters only the zero-rate failure event when the provider fails', async () => {
    const { app, calls } = createHarness(async () => {
      throw new Error('provider unavailable')
    })

    await request(app)
      .post('/api/listings-ai/describe')
      .send({ photo_urls: ['https://example.com/1.jpg'], provider: 'openai' })
      .expect(502)

    expect(calls.map((call) => call.type)).toEqual(['adapter', 'emit'])
    expect(calls[1].event).toMatchObject({
      actionKey: 'ai.description.failed',
      quantity: 1,
      metadata: {
        provider: 'openai',
        photo_count: 1,
        ai_success: false,
      },
    })
    expect(calls.some((call) => call.event?.actionKey === 'ai.description.generated')).toBe(false)
  })
})
