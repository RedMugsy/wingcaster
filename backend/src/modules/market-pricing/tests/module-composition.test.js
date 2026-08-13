import { describe, it, expect, vi } from 'vitest'
import { createModule } from '../index.js'

function fakeExpress() {
  const routes = []
  const app = {
    get: (path, ...handlers) => routes.push({ method: 'get', path, handlers }),
    post: (path, ...handlers) => routes.push({ method: 'post', path, handlers }),
    put: (path, ...handlers) => routes.push({ method: 'put', path, handlers }),
    delete: (path, ...handlers) => routes.push({ method: 'delete', path, handlers }),
  }
  return { app, routes }
}

function mockRes() {
  const res = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('Market Pricing module composition', () => {
  it('injects the module DAL into public reporting routes', async () => {
    const inserted = []
    const dal = {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockImplementation((_collection, item) => { inserted.push(item); return Promise.resolve(item) }),
      update: vi.fn().mockResolvedValue(0),
      remove: vi.fn().mockResolvedValue(0),
      transaction: vi.fn(),
    }
    const adapter = {
      getAreaProfiles: vi.fn().mockResolvedValue([]),
      getProperties: vi.fn().mockResolvedValue([]),
      getAreaById: vi.fn().mockResolvedValue(null),
      getPropertyById: vi.fn().mockResolvedValue(null),
    }
    const module = createModule({
      dal,
      platformAdapter: adapter,
      config: {
        enabled: true,
        baseCurrency: 'USD',
        defaultMatchConfig: { max_comparables: 20 },
        analysisExpiryDays: 7,
        recalculationWorkerEnabled: false,
        currencyRateSources: ['manual'],
        fallbackAiProviders: [],
      },
    })
    const { app, routes } = fakeExpress()
    module.registerRoutes(app)
    const route = routes.find((candidate) => candidate.path === '/api/pricing/report-comparable')
    const handler = route.handlers.at(-1)
    const req = { user: { id: 'user-1' }, body: { comparable_id: 'comp-1', comparable_type: 'external', reason: 'wrong_details' } }
    const res = mockRes()
    let forwardedError = null

    await handler(req, res, (err) => { forwardedError = err })

    expect(forwardedError).toBeNull()
    expect(res.status).toHaveBeenCalledWith(201)
    expect(inserted[0]).toMatchObject({ reporter_id: 'user-1', comparable_id: 'comp-1' })
  })
})
