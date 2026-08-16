/**
 * Reporting HTTP surface. All routes are platform-admin only.
 *
 *   GET /api/admin/billing/reports/mrr
 *   GET /api/admin/billing/reports/mrr-by-territory
 *   GET /api/admin/billing/reports/churn?window_days=30
 *   GET /api/admin/billing/reports/subscriptions-by-tier
 *   GET /api/admin/billing/reports/credit-exposure
 *
 *   GET /api/admin/billing/exports/subscriptions.csv
 *   GET /api/admin/billing/exports/credit-notes.csv?status=
 *   GET /api/admin/billing/exports/subscription-history.csv?tenant_id=&since=
 */

import {
  churnRate,
  mrrByCurrency,
  mrrByTerritory,
  pendingCreditExposure,
  subscriptionsByStatusAndTier,
} from './metrics.js'
import {
  creditNotesCsv,
  subscriptionHistoryCsv,
  subscriptionsCsv,
} from './exports.js'
import { tenantReconciliation } from './reconciliation.js'

export function registerReportingRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  const guards = [authMiddleware, requirePlatformAdmin].filter(Boolean)

  app.get('/api/admin/billing/reports/mrr', ...guards, async (_req, res) => {
    try {
      res.json(await mrrByCurrency())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/reports/mrr-by-territory', ...guards, async (_req, res) => {
    try {
      res.json(await mrrByTerritory())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/reports/churn', ...guards, async (req, res) => {
    try {
      const windowDays = Math.max(1, Math.min(365, Number(req.query.window_days) || 30))
      res.json(await churnRate({ windowDays }))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/reports/subscriptions-by-tier', ...guards, async (_req, res) => {
    try {
      res.json({ rows: await subscriptionsByStatusAndTier() })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/reports/credit-exposure', ...guards, async (_req, res) => {
    try {
      res.json({ rows: await pendingCreditExposure() })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // CSV exports
  app.get('/api/admin/billing/exports/subscriptions.csv', ...guards, async (_req, res) => {
    try {
      const csv = await subscriptionsCsv()
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="subscriptions-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.send(csv)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/exports/credit-notes.csv', ...guards, async (req, res) => {
    try {
      const csv = await creditNotesCsv({ status: req.query.status || null })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="credit-notes-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.send(csv)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Reconciliation — per-tenant commercial roll-up (subs + quota
  // ledger + credit-note balance + history counts + anomalies).
  app.get('/api/admin/billing/tenants/:tenantId/reconciliation', ...guards, async (req, res) => {
    try {
      const report = await tenantReconciliation(req.params.tenantId, {
        billingPeriod: req.query.billing_period || null,
      })
      res.json(report)
    } catch (err) {
      const status = err?.code === 'MISSING_FIELD' ? 400 : 500
      res.status(status).json({ error: err.message, code: err.code })
    }
  })

  app.get('/api/admin/billing/exports/subscription-history.csv', ...guards, async (req, res) => {
    try {
      const csv = await subscriptionHistoryCsv({
        tenantId: req.query.tenant_id || null,
        sinceIso: req.query.since || null,
      })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="subscription-history-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.send(csv)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
