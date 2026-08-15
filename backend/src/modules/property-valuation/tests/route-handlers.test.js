import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseCsv, normalizeExternalComparable, registerAdminRoutes } from '../interface/admin-routes.js'
import { registerPublicRoutes } from '../interface/public-routes.js'
import { registerRoleRoutes } from '../interface/role-routes.js'
import { listUserAgencyMemberships, listAgencyMemberships } from '../../../tenant-authorization.js'

vi.mock('../../../tenant-authorization.js', () => ({
  listUserAgencyMemberships: vi.fn().mockResolvedValue([]),
  listAgencyMemberships: vi.fn().mockResolvedValue([]),
}))

// Ownership checks in public-routes hit the real authz layer (which reads
// `properties` + `agency_members` via ../../../db.js). Route-handler tests
// don't spin up Postgres, so stub the helper to return the requested
// property for the caller — real-postgres coverage lives in the
// integration tests.
vi.mock('../../../lib/authz.js', async () => {
  const actual = await vi.importActual('../../../lib/authz.js')
  return {
    ...actual,
    assertOwnsProperty: vi.fn(async (_userId, propertyId) => ({ id: propertyId, agent_id: _userId })),
  }
})

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

const logger = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {}, child: () => logger }

describe('Admin Route Helpers', () => {
  it('parseCsv handles basic rows', () => {
    const text = 'price,currency,title\n100000,USD,Test A\n200000,USD,Test B'
    const parsed = parseCsv(text)
    expect(parsed.headers).toEqual(['price', 'currency', 'title'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toEqual({ price: '100000', currency: 'USD', title: 'Test A' })
  })

  it('parseCsv handles quoted commas', () => {
    const text = 'price,title\n100000,"Luxury villa, Batroun"\n200000,Plain'
    const parsed = parseCsv(text)
    expect(parsed.rows[0].title).toBe('Luxury villa, Batroun')
    expect(parsed.rows[1].title).toBe('Plain')
  })

  it('normalizeExternalComparable skips invalid price', () => {
    expect(normalizeExternalComparable({ price: 'not-a-number', currency: 'USD' })).toBeNull()
    expect(normalizeExternalComparable({ currency: 'USD' })).toBeNull()
    expect(normalizeExternalComparable({ price: '0', currency: 'USD' })).toBeNull()
  })

  it('normalizeExternalComparable defaults optional fields', () => {
    const result = normalizeExternalComparable({ price: '150000', currency: 'USD' })
    expect(result).toMatchObject({
      price: 150000,
      currency: 'USD',
      source: 'manual_csv',
      property_type: 'apartment',
      condition: 'unknown',
      status: 'active',
      price_normalized_usd: 150000,
    })
  })

  it('normalizeExternalComparable preserves explicit values', () => {
    const result = normalizeExternalComparable({
      price: '300000',
      currency: 'LBP',
      source: 'agent_csv',
      source_url: 'https://example.com/1',
      external_id: 'ext-1',
      title: 'Villa',
      property_type: 'villa',
      bedrooms: '3',
      bathrooms: '2',
      area_sqm: '220',
      condition: 'newly_renovated',
      location_text: 'Mar Mikhael',
      latitude: '33.89',
      longitude: '35.51',
    })
    expect(result).toMatchObject({
      source: 'agent_csv',
      price: 300000,
      currency: 'LBP',
      price_normalized_usd: null,
      property_type: 'villa',
      bedrooms: 3,
      bathrooms: 2,
      area_sqm: 220,
      condition: 'newly_renovated',
      location_text: 'Mar Mikhael',
      latitude: 33.89,
      longitude: 35.51,
    })
  })
})

describe('Admin Route Registration', () => {
  it('registers all expected admin endpoints', () => {
    const { app, routes } = fakeExpress()
    const services = {
      configService: {},
      currencyService: {},
      comparableService: {},
      analysisService: {},
      trendService: {},
      scraperService: {},
      dal: {},
      adapter: {},
      logger,
    }
    registerAdminRoutes(app, services)

    const paths = routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)
    expect(paths).toContain('GET /api/admin/pricing/configs')
    expect(paths).toContain('POST /api/admin/pricing/configs')
    expect(paths).toContain('POST /api/admin/pricing/external-comparables/import-csv')
    expect(paths).toContain('POST /api/admin/pricing/currency-rates/refresh')
    expect(paths).toContain('POST /api/admin/pricing/recalculate')
    expect(paths).toContain('GET /api/admin/pricing/agent-price-reports')
    expect(paths).toContain('POST /api/admin/pricing/agent-price-reports/:id/review')
    expect(paths).toContain('GET /api/admin/pricing/reports')
    expect(paths).toContain('POST /api/admin/pricing/reports/:id/review')
  })

  it('CSV import route imports valid rows and logs failures', async () => {
    const { app, routes } = fakeExpress()
    const inserted = []
    const importLogs = []
    const services = {
      scraperService: {
        upsertExternalComparable: vi.fn().mockImplementation((row) => {
          inserted.push(row)
          return Promise.resolve(row)
        }),
      },
      dal: {
        insert: vi.fn().mockImplementation((collection, item) => {
          if (collection === 'csv_import_logs') importLogs.push(item)
          return Promise.resolve(item)
        }),
      },
      logger,
    }
    registerAdminRoutes(app, services)

    const csvRoute = routes.find((r) => r.path === '/api/admin/pricing/external-comparables/import-csv')
    expect(csvRoute).toBeDefined()

    const req = { user: { id: 'admin-1' }, body: { csv_text: 'price,currency,title\n100000,USD,Valid\ninvalid,USD,Missing price\n200000,USD,Also valid' } }
    const res = mockRes()
    const handler = csvRoute.handlers[csvRoute.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ imported: 2, failed: 1 }))
    expect(inserted).toHaveLength(2)
    expect(importLogs[0].rows_received).toBe(3)
    expect(importLogs[0].rows_imported).toBe(2)
    expect(importLogs[0].rows_failed).toBe(1)
  })

  it('currency refresh route returns fetched rate', async () => {
    const { app, routes } = fakeExpress()
    const services = {
      currencyService: {
        refreshRates: vi.fn().mockResolvedValue({ rate: 89000, source: 'lira_rate' }),
      },
      logger,
    }
    registerAdminRoutes(app, services)

    const refreshRoute = routes.find((r) => r.path === '/api/admin/pricing/currency-rates/refresh')
    const req = { user: { id: 'admin-1' }, body: {} }
    const res = mockRes()
    const handler = refreshRoute.handlers[refreshRoute.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ rate: 89000, source: 'lira_rate' })
  })

  it('currency refresh route returns 503 when all providers fail', async () => {
    const { app, routes } = fakeExpress()
    const services = {
      currencyService: {
        refreshRates: vi.fn().mockResolvedValue(null),
      },
      logger,
    }
    registerAdminRoutes(app, services)

    const refreshRoute = routes.find((r) => r.path === '/api/admin/pricing/currency-rates/refresh')
    const req = { user: { id: 'admin-1' }, body: {} }
    const res = mockRes()
    const handler = refreshRoute.handlers[refreshRoute.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ error: 'All currency rate providers failed' })
  })

  it('agent price report review updates status and reviewer', async () => {
    const { app, routes } = fakeExpress()
    const reports = [{ id: 'rpt-1', status: 'pending' }]
    const services = {
      dal: {
        findOne: vi.fn().mockImplementation((collection, filter) => {
          if (collection === 'agent_price_reports') return Promise.resolve(reports.find(filter))
          return Promise.resolve(null)
        }),
        update: vi.fn().mockImplementation((collection, filter, updater) => {
          const idx = reports.findIndex(filter)
          if (idx >= 0) reports[idx] = updater(reports[idx])
          return Promise.resolve(reports[idx])
        }),
      },
      logger,
    }
    registerAdminRoutes(app, services)

    const reviewRoute = routes.find((r) => r.path === '/api/admin/pricing/agent-price-reports/:id/review')
    const req = { user: { id: 'admin-1' }, params: { id: 'rpt-1' }, body: { status: 'verified', notes: 'Looks good' } }
    const res = mockRes()
    const handler = reviewRoute.handlers[reviewRoute.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ success: true })
    expect(reports[0].status).toBe('verified')
    expect(reports[0].reviewed_by).toBe('admin-1')
    expect(reports[0].review_notes).toBe('Looks good')
  })
})

describe('Public Route Registration', () => {
  it('registers public pricing endpoints', () => {
    const { app, routes } = fakeExpress()
    const services = {
      analysisService: {},
      comparableService: {},
      trendService: {},
      configService: {},
      dal: {},
      adapter: {},
      logger,
    }
    registerPublicRoutes(app, services)

    const paths = routes.map((r) => `${r.method.toUpperCase()} ${r.path}`)
    expect(paths).toContain('GET /api/pricing/analysis/:propertyId')
    expect(paths).toContain('GET /api/pricing/comparables/:propertyId')
    expect(paths).toContain('GET /api/pricing/trends/:areaId')
    expect(paths).toContain('POST /api/pricing/report-comparable')
    expect(paths).toContain('POST /api/pricing/agent-price-reports')
  })

  it('report comparable route creates pending report', async () => {
    const { app, routes } = fakeExpress()
    const inserted = []
    const services = {
      dal: {
        insert: vi.fn().mockImplementation((collection, item) => {
          inserted.push(item)
          return Promise.resolve(item)
        }),
      },
      logger,
    }
    registerPublicRoutes(app, services)

    const route = routes.find((r) => r.path === '/api/pricing/report-comparable')
    const req = { user: { id: 'user-1' }, body: { comparable_id: 'comp-1', comparable_type: 'external', reason: 'fake_listing', notes: 'Already sold' } }
    const res = mockRes()
    const handler = route.handlers[route.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(201)
    expect(inserted[0]).toMatchObject({ comparable_id: 'comp-1', comparable_type: 'external', reason: 'fake_listing', status: 'pending' })
  })

  it('report comparable route rejects missing fields', async () => {
    const { app, routes } = fakeExpress()
    const services = { dal: { insert: vi.fn() }, logger }
    registerPublicRoutes(app, services)

    const route = routes.find((r) => r.path === '/api/pricing/report-comparable')
    const req = { user: { id: 'user-1' }, body: { comparable_id: 'comp-1' } }
    const res = mockRes()
    const handler = route.handlers[route.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'comparable_id, comparable_type, and reason are required' })
  })

  it('agent price report route creates pending report', async () => {
    const { app, routes } = fakeExpress()
    const inserted = []
    const services = {
      dal: {
        insert: vi.fn().mockImplementation((collection, item) => {
          inserted.push(item)
          return Promise.resolve(item)
        }),
      },
      logger,
    }
    registerPublicRoutes(app, services)

    const route = routes.find((r) => r.path === '/api/pricing/agent-price-reports')
    const req = {
      user: { id: 'agent-1' },
      body: {
        property_id: 'prop-1',
        sold_price: 420000,
        currency: 'USD',
        sold_date: '2026-01-15',
        notes: 'Verified sale',
      },
    }
    const res = mockRes()
    const handler = route.handlers[route.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(201)
    expect(inserted[0]).toMatchObject({
      agent_id: 'agent-1',
      property_id: 'prop-1',
      sold_price: 420000,
      currency: 'USD',
      sold_date: '2026-01-15',
      status: 'pending',
    })
  })

  it('agent price report route rejects invalid sold price', async () => {
    const { app, routes } = fakeExpress()
    const services = { dal: { insert: vi.fn() }, logger }
    registerPublicRoutes(app, services)

    const route = routes.find((r) => r.path === '/api/pricing/agent-price-reports')
    const req = { user: { id: 'agent-1' }, body: { sold_price: 0 } }
    const res = mockRes()
    const handler = route.handlers[route.handlers.length - 1]
    await handler(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'sold_price is required' })
  })
})

describe('Agent and Agency Pricing Routes', () => {
  it('returns only the authenticated agent owned portfolio', async () => {
    const { app, routes } = fakeExpress()
    const properties = [
      { id: 'mine', agent_id: 'agent-1', status: 'active', price: 100000 },
      { id: 'other', agent_id: 'agent-2', status: 'active', price: 200000 },
    ]
    const services = {
      dal: {
        findAll: vi.fn().mockImplementation((collection, filter) => {
          const rows = collection === 'properties' ? properties : []
          return Promise.resolve(rows.filter(filter))
        }),
      },
      analysisService: { getAnalysis: vi.fn().mockResolvedValue({ comparable_count: 2, target_vs_median: 'at', confidence: 'high', rate_is_stale: false }) },
      recalculationJobService: {},
      logger,
    }
    registerRoleRoutes(app, services)
    const route = routes.find((item) => item.path === '/api/agent/pricing/portfolio')
    const req = { user: { id: 'agent-1' } }
    const res = mockRes()
    await route.handlers[route.handlers.length - 1](req, res, () => {})

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ total_listings: 1, analyzed_listings: 1 }),
      listings: [expect.objectContaining({ id: 'mine' })],
    }))
  })

  it('rejects price adjustment for a listing owned by another agent', async () => {
    const { app, routes } = fakeExpress()
    const services = {
      dal: { findOne: vi.fn().mockResolvedValue(null) },
      analysisService: {},
      recalculationJobService: {},
      logger,
    }
    registerRoleRoutes(app, services)
    const route = routes.find((item) => item.path === '/api/agent/pricing/properties/:propertyId/adjust-price')
    const req = { user: { id: 'agent-1' }, params: { propertyId: 'other' }, body: { new_price: 300000 } }
    const res = mockRes()
    await route.handlers[route.handlers.length - 1](req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Owned property not found' })
  })

  it('updates an owned price, records old and new values, and invalidates affected analyses', async () => {
    const { app, routes } = fakeExpress()
    const property = { id: 'mine', agent_id: 'agent-1', status: 'active', price: 100000, currency: 'USD' }
    const inserted = []
    const services = {
      dal: {
        findOne: vi.fn().mockImplementation((collection, filter) => {
          const rows = collection === 'properties' ? [property] : collection === 'property_price_analyses' ? [{ id: 'analysis-1', property_id: 'mine' }] : []
          return Promise.resolve(rows.find(filter) || null)
        }),
        update: vi.fn().mockResolvedValue(1),
        insert: vi.fn().mockImplementation((collection, item) => { inserted.push({ collection, item }); return Promise.resolve(item) }),
      },
      analysisService: {},
      recalculationJobService: { invalidateForPropertyChange: vi.fn().mockResolvedValue(undefined) },
      logger,
    }
    registerRoleRoutes(app, services)
    const route = routes.find((item) => item.path === '/api/agent/pricing/properties/:propertyId/adjust-price')
    const req = { user: { id: 'agent-1' }, params: { propertyId: 'mine' }, body: { new_price: 125000, reason: 'Seller approved' } }
    const res = mockRes()
    await route.handlers[route.handlers.length - 1](req, res, () => {})

    expect(inserted[0]).toMatchObject({
      collection: 'pricing_decisions',
      item: expect.objectContaining({ actor_id: 'agent-1', action: 'adjust_price', old_price: 100000, new_price: 125000, reason: 'Seller approved' }),
    })
    expect(services.recalculationJobService.invalidateForPropertyChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine', price: 125000 }))
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('rejects agency portfolio access without active membership', async () => {
    const { app, routes } = fakeExpress()
    const services = {
      dal: { findAll: vi.fn().mockResolvedValue([]) },
      analysisService: {},
      recalculationJobService: {},
      logger,
    }
    vi.mocked(listUserAgencyMemberships).mockResolvedValueOnce([])
    registerRoleRoutes(app, services)
    const route = routes.find((item) => item.path === '/api/agency/pricing/portfolio')
    const req = { user: { id: 'agent-1' } }
    const res = mockRes()
    await route.handlers[route.handlers.length - 1](req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Active agency membership required' })
    expect(listUserAgencyMemberships).toHaveBeenCalledWith('agent-1')
  })
})
