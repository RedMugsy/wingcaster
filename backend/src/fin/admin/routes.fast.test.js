import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { registerFinOpsAdminRoutes } from './routes.js'

function mount({ role = 'platform_admin', elevated = false } = {}) {
  const app = express()
  app.use(express.json())
  registerFinOpsAdminRoutes(app, {
    authMiddleware: (req, _res, next) => {
      req.user = {
        id: '00000000-0000-0000-0000-0000000000a1',
        token_version: 0,
        platform_role: role,
        email: 'admin@example.test',
      }
      if (elevated) req.elevated = true
      next()
    },
    requirePlatformAdmin: (req, res, next) => {
      if (req.user?.platform_role !== 'platform_admin') {
        return res.status(403).json({ error: 'Forbidden: platform admin required' })
      }
      next()
    },
  })
  return app
}

const WRITES = [
  ['post', '/api/admin/fin/facilities'],
  ['post', '/api/admin/fin/facilities/x/pause'],
  ['post', '/api/admin/fin/facilities/x/resume'],
  ['post', '/api/admin/fin/facilities/x/suspend'],
  ['post', '/api/admin/fin/facilities/x/close'],
  ['post', '/api/admin/fin/facilities/x/limit'],
  ['post', '/api/admin/fin/reconciliation/run'],
  ['post', '/api/admin/fin/reconciliation/drift/x/resolve'],
  ['post', '/api/admin/fin/approvals/x/approve'],
  ['post', '/api/admin/fin/approvals/x/reject'],
  ['post', '/api/admin/fin/dunning/cases/x/advance'],
  ['post', '/api/admin/fin/dunning/cases/x/cure'],
  ['post', '/api/admin/fin/dunning/cases/x/write-off'],
  ['post', '/api/admin/fin/billing/periods/x/close'],
  ['post', '/api/admin/fin/billing/periods/x/reopen'],
  ['post', '/api/admin/fin/invoices/x/void'],
  ['post', '/api/admin/fin/invoices/x/credit-note'],
  ['post', '/api/admin/fin/invoices/x/debit-note'],
  ['post', '/api/admin/fin/payments'],
  ['post', '/api/admin/fin/payments/x/apply'],
  ['post', '/api/admin/fin/payments/x/reverse'],
  ['post', '/api/admin/fin/accounting/periods/x/soft-close'],
  ['post', '/api/admin/fin/accounting/periods/x/hard-close'],
  ['post', '/api/admin/fin/accounting/periods/x/reopen'],
]

describe('fin.admin ops fast gates', () => {
  it.each(WRITES)('%s %s refuses a non-admin before opening a tx', async (method, route) => {
    const app = mount({ role: 'agent' })
    const res = await request(app)[method](route).send({ reason_code: 'TEST', environment: 'LIVE', now: '1999-01-01' })
    expect(res.status).toBe(403)
  })

  it.each(WRITES)('%s %s refuses without elevation before opening a tx', async (method, route) => {
    const app = mount({ role: 'platform_admin' })
    const res = await request(app)[method](route).send({ reason_code: 'TEST' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
  })

  it('GET overview refuses a non-admin', async () => {
    const app = mount({ role: 'agent' })
    const res = await request(app).get('/api/admin/fin/overview')
    expect(res.status).toBe(403)
  })
})
