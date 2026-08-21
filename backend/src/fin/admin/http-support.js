import express from 'express'
import { vi } from 'vitest'
import { signElevatedToken } from '../../auth.js'
import { registerFinOpsAdminRoutes } from './routes.js'

export const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1'
const SECRET = 'stage-12-ops-secret'

export async function makeOpsApp(databaseUrl, { role = 'platform_admin', finEnvironment = 'LIVE' } = {}) {
  process.env.JWT_SECRET = SECRET
  process.env.VITEST = '1'
  // Enable Stage 11 vendor read routes in the ops test harness so
  // /api/admin/fin/vendors serves Stage 11's real router (200 + rows)
  // instead of requireVendorOps gating with 501. Post-merge integration
  // test wiring, no domain change.
  if (process.env.FIN_VENDOR_OPS_ENABLED == null || process.env.FIN_VENDOR_OPS_ENABLED === '') {
    process.env.FIN_VENDOR_OPS_ENABLED = '1'
  }
  vi.resetModules()
  const { configure } = await import('../../db.js')
  configure({ databaseUrl, force: true })
  const { registerFinOpsAdminRoutes: register } = await import('./routes.js')
  const { signElevatedToken: sign } = await import('../../auth.js')
  const app = express()
  app.use(express.json())
  const fakeAuth = (req, _res, next) => {
    req.user = {
      id: ADMIN_ID,
      token_version: 0,
      platform_role: role,
      email: 'admin@example.test',
      fin_environment: finEnvironment,
    }
    next()
  }
  register(app, {
    authMiddleware: fakeAuth,
    requirePlatformAdmin: (req, res, next) => {
      if (req.user?.platform_role !== 'platform_admin') {
        return res.status(403).json({ error: 'Forbidden: platform admin required' })
      }
      next()
    },
  })
  return {
    app,
    elevate: () => sign({ userId: ADMIN_ID, tokenVersion: 0 }),
  }
}

export function writeHeaders(token, extra = {}) {
  return {
    'X-Elevated-Token': token,
    'If-Match': extra.ifMatch || '"1"',
    'Idempotency-Key': extra.idempotencyKey || extra['Idempotency-Key'] || `ops-${Date.now()}-${Math.random()}`,
  }
}

export { registerFinOpsAdminRoutes, signElevatedToken }
