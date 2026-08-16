/**
 * HTTP surface for the notifications engine.
 *
 * Tenant self-serve:
 *   GET  /api/billing/notifications/preferences
 *   PUT  /api/billing/notifications/preferences
 *   GET  /api/billing/notifications/history
 *
 * Admin:
 *   GET  /api/admin/billing/notifications/events
 *   GET  /api/admin/billing/notifications/deliveries
 */

import { query } from '../../db.js'
import { ALL_EVENT_KINDS } from './events.js'
import { bulkSetPreferences, fullPreferenceMatrix } from './preferences.js'
import { listDeliveries } from './deliveries.js'

function actorFrom(req) {
  return req.user?.id || req.agent?.id || null
}

export function registerNotificationRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  const guards = [authMiddleware, requirePlatformAdmin].filter(Boolean)

  // ---------- Tenant ----------
  app.get('/api/billing/notifications/preferences', authMiddleware, async (req, res) => {
    try {
      const matrix = await fullPreferenceMatrix(req.user.id, { channels: ['email'] })
      res.json({ preferences: matrix, event_kinds: ALL_EVENT_KINDS })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.put('/api/billing/notifications/preferences', authMiddleware, async (req, res) => {
    try {
      const updates = Array.isArray(req.body?.updates) ? req.body.updates : []
      if (updates.length === 0) {
        return res.status(400).json({ error: 'updates[] is required' })
      }
      const rows = await bulkSetPreferences(req.user.id, updates, { actorId: req.user.id })
      res.json({ preferences: rows })
    } catch (err) {
      res.status(err?.code === 'INVALID_CHANNEL' || err?.code === 'MISSING_FIELD' ? 400 : 500)
        .json({ error: err.message, code: err.code })
    }
  })

  app.get('/api/billing/notifications/history', authMiddleware, async (req, res) => {
    try {
      const limit = Math.min(500, Number(req.query.limit) || 100)
      const rows = await query(
        `SELECT e.id, e.event_kind, e.subscription_id, e.subject, e.created_at,
                COUNT(d.id) FILTER (WHERE d.status = 'sent')::int    AS deliveries_sent,
                COUNT(d.id) FILTER (WHERE d.status = 'skipped')::int AS deliveries_skipped,
                COUNT(d.id) FILTER (WHERE d.status = 'failed')::int  AS deliveries_failed
           FROM commercial.notification_events e
           LEFT JOIN commercial.notification_deliveries d ON d.event_id = e.id
          WHERE e.tenant_id = $1
          GROUP BY e.id
          ORDER BY e.created_at DESC
          LIMIT $2`,
        [req.user.id, limit],
      )
      res.json({ events: rows })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ---------- Admin ----------
  app.get('/api/admin/billing/notifications/events', ...guards, async (req, res) => {
    try {
      const limit = Math.min(1000, Number(req.query.limit) || 200)
      const params = []
      const where = []
      if (req.query.tenant_id) { params.push(req.query.tenant_id); where.push(`tenant_id = $${params.length}`) }
      if (req.query.event_kind) { params.push(req.query.event_kind); where.push(`event_kind = $${params.length}`) }
      if (req.query.subscription_id) { params.push(req.query.subscription_id); where.push(`subscription_id = $${params.length}`) }
      params.push(limit)
      const rows = await query(
        `SELECT id, event_kind, tenant_id, subscription_id, subject, context, created_at
           FROM commercial.notification_events
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY created_at DESC
          LIMIT $${params.length}`,
        params,
      )
      res.json({ events: rows })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/admin/billing/notifications/deliveries', ...guards, async (req, res) => {
    try {
      const deliveries = await listDeliveries({
        eventId: req.query.event_id || null,
        status: req.query.status || null,
        channel: req.query.channel || null,
        limit: Math.min(1000, Number(req.query.limit) || 200),
      })
      res.json({ deliveries })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
