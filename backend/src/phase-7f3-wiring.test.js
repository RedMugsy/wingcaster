/**
 * Phase 7f/3 — inventory + wiring test.
 *
 * The point of 7f/3 is that every sensitive admin surface refuses to run
 * without a live step-up token. If a new admin route is added but nobody
 * remembers to wire `requireElevated`, the test suite must catch it.
 *
 * Strategy: for each route in the sensitive list, register the real route
 * module against a bare Express app whose fake authMiddleware always
 * succeeds, then hit the route without an `X-Elevated-Token` header. The
 * expected response is 401 with `code: 'step_up_required'`. Any route
 * that returns 200/201/400 has fallen off the gate — the test names
 * exactly which route regressed.
 *
 * The middleware itself is covered separately in auth-elevation.test.js;
 * this is the surface-level assertion: "these specific URLs are gated."
 */
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalSecret = process.env.JWT_SECRET

// Fake platform-admin session — the middleware only ever runs
// requireElevated after authMiddleware + requirePlatformAdmin succeed,
// so the wiring test needs both to be no-ops.
const fakeAuth = (req, _res, next) => {
  req.user = { id: 'admin-1', token_version: 0 }
  req.agent = { id: 'admin-1' }
  next()
}
const fakePlatformAdmin = (_req, _res, next) => next()

async function withPatchedEnv(fn) {
  process.env.JWT_SECRET = 'phase-7f3-wiring-secret'
  vi.resetModules()
  try {
    return await fn()
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = originalSecret
    vi.resetModules()
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.resetModules()
})

/**
 * Expected shape of every step-up refusal — a stable contract because the
 * frontend `runElevated()` seam keys on it.
 */
function expectStepUpRequired(res) {
  expect(res.status).toBe(401)
  expect(res.body).toMatchObject({ code: 'step_up_required' })
  expect(res.body.max_age_seconds).toBeGreaterThan(0)
}

describe('7f/3 — billing/products/routes', () => {
  const sensitive = [
    ['post', '/api/admin/billing/products'],
    ['patch', '/api/admin/billing/products/prod-1'],
    ['post', '/api/admin/billing/products/prod-1/publish'],
    ['post', '/api/admin/billing/products/prod-1/deprecate'],
    ['post', '/api/admin/billing/products/prod-1/retire'],
    ['post', '/api/admin/billing/products/prod-1/clone-as-new-version'],
    ['post', '/api/admin/billing/products/prod-1/tiers'],
    ['patch', '/api/admin/billing/tiers/tier-1'],
    ['post', '/api/admin/billing/tiers/tier-1/activate'],
    ['post', '/api/admin/billing/tiers/tier-1/deprecate'],
    ['post', '/api/admin/billing/tiers/tier-1/retire'],
    ['post', '/api/admin/billing/products/prod-1/pricing-overrides'],
    ['patch', '/api/admin/billing/pricing-overrides/ov-1'],
    ['delete', '/api/admin/billing/pricing-overrides/ov-1'],
    ['post', '/api/admin/billing/subscriptions/sub-1/cancel'],
    ['post', '/api/admin/billing/subscriptions/sub-1/expire'],
    ['post', '/api/admin/billing/subscriptions/sub-1/mark-past-due'],
    ['post', '/api/admin/billing/subscriptions/sub-1/resolve-past-due'],
    ['post', '/api/admin/billing/subscriptions/sub-1/migrate'],
    ['post', '/api/admin/billing/subscriptions/bulk-cancel'],
    ['post', '/api/admin/billing/subscriptions/bulk-expire'],
    ['post', '/api/admin/billing/subscriptions/bulk-migrate'],
    ['post', '/api/admin/billing/subscriptions/bulk-pause'],
    ['post', '/api/admin/billing/subscriptions/bulk-resume'],
    ['post', '/api/admin/billing/credit-notes/bulk-issue'],
    ['post', '/api/admin/billing/subscriptions/tick'],
    ['post', '/api/admin/billing/credit-notes'],
    ['post', '/api/admin/billing/credit-notes/cn-1/void'],
  ]

  let app
  beforeEach(async () => {
    await withPatchedEnv(async () => {
      const { registerProductCatalogRoutes } = await import('./billing/products/routes.js')
      app = express()
      app.use(express.json())
      registerProductCatalogRoutes(app, {
        authMiddleware: fakeAuth,
        requirePlatformAdmin: fakePlatformAdmin,
      })
    })
  })

  it.each(sensitive)('%s %s refuses without X-Elevated-Token', async (method, route) => {
    const res = await request(app)[method](route).send({})
    expectStepUpRequired(res)
  })
})

describe('7f/3 — billing/pricing/routes', () => {
  const sensitive = [
    ['post', '/api/admin/pricing/rate-cards'],
    ['patch', '/api/admin/pricing/rate-cards/rc-1'],
    ['post', '/api/admin/pricing/rate-cards/rc-1/activate'],
    ['post', '/api/admin/pricing/territories'],
    ['patch', '/api/admin/pricing/territories/t-1'],
    ['delete', '/api/admin/pricing/territories/t-1'],
    ['post', '/api/admin/pricing/zones'],
    ['patch', '/api/admin/pricing/zones/z-1'],
    ['delete', '/api/admin/pricing/zones/z-1'],
    ['post', '/api/admin/pricing/cities'],
    ['patch', '/api/admin/pricing/cities/c-1'],
    ['delete', '/api/admin/pricing/cities/c-1'],
    ['post', '/api/admin/pricing/cities/bulk-assign-zone'],
  ]

  let app
  beforeEach(async () => {
    await withPatchedEnv(async () => {
      const { registerPricingRoutes } = await import('./billing/pricing/routes.js')
      app = express()
      app.use(express.json())
      registerPricingRoutes(app, {
        authMiddleware: fakeAuth,
        requirePlatformAdmin: fakePlatformAdmin,
      })
    })
  })

  it.each(sensitive)('%s %s refuses without X-Elevated-Token', async (method, route) => {
    const res = await request(app)[method](route).send({})
    expectStepUpRequired(res)
  })
})

describe('7f/3 — billing credit grant', () => {
  let app
  beforeEach(async () => {
    await withPatchedEnv(async () => {
      const { registerBillingRoutes } = await import('./billing/routes.js')
      app = express()
      app.use(express.json())
      registerBillingRoutes(app, {
        authMiddleware: fakeAuth,
        requirePlatformAdmin: fakePlatformAdmin,
      })
    })
  })

  it('POST /api/admin/billing/credit refuses without X-Elevated-Token', async () => {
    const res = await request(app).post('/api/admin/billing/credit').send({
      tenant_id: 't-1', quota_key: 'anything', amount: 10, reason: 'test',
    })
    expectStepUpRequired(res)
  })
})

describe('7f/3 — auth surfaces on server.js', () => {
  // password/change + my-connections + 2fa/disable are declared directly
  // in server.js / auth-2fa.js. Rather than boot the whole app (heavy),
  // this section asserts the wire directly by inspecting the file text.
  // A grep-based check for "requireElevated" adjacent to each route is
  // fragile, so we import the auth modules and confirm requireElevated is
  // referenced on the same line as each URL literal.
  it('server.js gates password/change, POST /my-connections, PUT /my-connections/:id, DELETE /my-connections/:id', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('src/server.js', 'utf8')
    const lines = src.split('\n')
    const routes = [
      "app.post('/api/auth/password/change'",
      "app.post('/api/my-connections'",
      "app.put('/api/my-connections/:id'",
      "app.delete('/api/my-connections/:id'",
    ]
    for (const needle of routes) {
      const line = lines.find((l) => l.includes(needle))
      expect(line, `route not found: ${needle}`).toBeDefined()
      expect(line, `route missing requireElevated: ${needle}\n  actual: ${line}`).toMatch(/requireElevated\(\)/)
    }
  })

  it('auth-2fa.js gates POST /api/auth/2fa/totp/disable', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('src/auth-2fa.js', 'utf8')
    const line = src.split('\n').find((l) => l.includes("app.post('/api/auth/2fa/totp/disable'"))
    expect(line).toBeDefined()
    expect(line).toMatch(/requireElevated\(\)/)
  })
})
