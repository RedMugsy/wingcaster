/**
 * Admin API for platform message templates.
 *
 * All routes are platform-admin only. WRITE routes additionally require
 * step-up elevation (an X-Elevated-Token header obtained via
 * /api/auth/step-up) so a hijacked but not-recently-verified session
 * cannot rewrite the OTP template that sends its own step-up codes —
 * see auth.js#requireElevated.
 *
 * READ routes stay behind requirePlatformAdmin only. Requiring step-up
 * to look at the template list would push the elevation prompt into a
 * flow the admin runs constantly, training them to click through it
 * without thinking — the exact failure mode elevation exists to prevent.
 *
 * Test-send is gated by elevation AND by "recipient must be the caller's
 * own email" — an admin who genuinely wants to try their draft on a
 * customer address can do that after saving; the endpoint's purpose is
 * "does this look right in an inbox" for the admin themselves.
 */

import { z } from 'zod'
import { validate } from '../../lib/validation.js'
import { requireElevated } from '../../auth.js'
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplates,
  getTemplate,
  getVersionHistory,
  revertTemplateToVersion,
  resolveTemplate,
  renderTemplate,
  findUnknownVariables,
  extractAllVariables,
} from './index.js'
import { sendEmail } from '../../lib/notifications/email.js'

const CHANNELS = ['email', 'whatsapp', 'sms']
const CATEGORIES = ['auth', 'onboarding', 'billing', 'notification', 'marketing']
const EDITOR_MODES = ['unlayer', 'mjml', 'raw']

// A stable-identifier code the send sites reference — lowercase snake case
// so it can be used in SQL and env vars without escaping.
const codeSchema = z.string().min(2).max(80).regex(/^[a-z][a-z0-9_]*$/, 'code must be lowercase snake_case')

const createSchema = z.object({
  code: codeSchema,
  display_name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(''),
  channel: z.enum(CHANNELS),
  category: z.enum(CATEGORIES),
  language: z.string().min(2).max(10).optional().default('en'),
  territory_id: z.string().uuid().nullable().optional(),
  subject: z.string().max(500).optional().nullable(),
  html_body: z.string().max(500_000).optional().nullable(),
  text_body: z.string().max(500_000).optional().nullable(),
  design_json: z.any().optional().nullable(),
  editor_mode: z.enum(EDITOR_MODES).optional().default('unlayer'),
  required_variables: z.array(z.string().min(1)).max(50).optional().default([]),
  optional_variables: z.array(z.string().min(1)).max(200).optional().default([]),
  is_active: z.boolean().optional().default(true),
  // is_seed is deliberately absent — admins cannot create seed rows via
  // the API. Seeds are planted by the migration that ships them.
})

const updateSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  subject: z.string().max(500).optional().nullable(),
  html_body: z.string().max(500_000).optional().nullable(),
  text_body: z.string().max(500_000).optional().nullable(),
  design_json: z.any().optional().nullable(),
  editor_mode: z.enum(EDITOR_MODES).optional(),
  required_variables: z.array(z.string().min(1)).max(50).optional(),
  optional_variables: z.array(z.string().min(1)).max(200).optional(),
  is_active: z.boolean().optional(),
  change_note: z.string().max(500).optional(),
})

const revertSchema = z.object({
  version: z.number().int().positive(),
})

const previewSchema = z.object({
  variables: z.record(z.any()).optional().default({}),
})

const testSendSchema = z.object({
  // Only for the admin's own email. Enforcement lives in the handler
  // rather than the schema so the mismatch reason surfaces as a 403
  // with a meaningful body, not a validation error.
  to: z.string().email(),
  variables: z.record(z.any()).optional().default({}),
})

/**
 * Map a service-layer error code to an HTTP status. Keeping this small
 * and explicit is deliberate — anything the service throws with a `code`
 * has a stable meaning, and mapping in one place stops handlers from
 * drifting into inconsistent status codes.
 */
function statusForError(err) {
  switch (err?.code) {
    case 'TEMPLATE_NOT_FOUND':
    case 'VERSION_NOT_FOUND':
      return 404
    case 'DUPLICATE_TEMPLATE':
      return 409
    case 'CANNOT_DELETE_SEED_TEMPLATE':
      return 409
    case 'TEMPLATE_MISSING_REQUIRED_VARIABLES':
    case 'INVALID_CHANNEL':
    case 'INVALID_EDITOR_MODE':
    case 'INVALID_CATEGORY':
    case 'MISSING_SUBJECT':
    case 'MISSING_BODY':
    case 'MISSING_CODE':
    case 'MISSING_DISPLAY_NAME':
    case 'MISSING_ID':
      return 400
    default:
      return 500
  }
}

function respondError(res, err) {
  const status = statusForError(err)
  const body = { error: err.message, code: err.code || 'UNKNOWN' }
  if (err.missing) body.missing = err.missing
  return res.status(status).json(body)
}

/**
 * Extra guard on WRITE routes: verify the caller genuinely has
 * platform_role='platform_admin'. requirePlatformAdmin already checks
 * this at the DB level via isPlatformAdmin(id), so the duplication is
 * belt-and-braces — this defends against a future refactor that widens
 * requirePlatformAdmin to include, say, agency owners.
 */
function requireExplicitPlatformAdmin(req, res, next) {
  if (req.user?.platform_role !== 'platform_admin') {
    return res.status(403).json({ error: 'Forbidden: platform admin required' })
  }
  next()
}

/**
 * Preview mode: render a template body with sample variables without
 * saving anything. Used by the admin UI's live preview pane and by the
 * test-send handler.
 */
function previewTemplate(template, variables) {
  const rendered = renderTemplate(template, variables)
  const unknown = findUnknownVariables(
    { subject: template.subject, html_body: template.html_body, text_body: template.text_body },
    template.required_variables,
    template.optional_variables,
  )
  return {
    rendered,
    all_variables: extractAllVariables(template),
    unknown_variables: unknown,
    required_variables: template.required_variables || [],
    optional_variables: template.optional_variables || [],
  }
}

export function registerPlatformTemplateAdminRoutes(app, { authMiddleware, requirePlatformAdmin, logActivity } = {}) {
  if (!authMiddleware) throw new Error('registerPlatformTemplateAdminRoutes requires authMiddleware')
  if (!requirePlatformAdmin) throw new Error('registerPlatformTemplateAdminRoutes requires requirePlatformAdmin')
  const activity = logActivity || (async () => {})

  const readGuards = [authMiddleware, requirePlatformAdmin]
  const writeGuards = [authMiddleware, requirePlatformAdmin, requireExplicitPlatformAdmin, requireElevated()]

  // -------- LIST + READ --------

  app.get('/api/admin/message-templates', readGuards, async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true'
      const templates = await listTemplates({
        code: req.query.code || undefined,
        channel: req.query.channel || undefined,
        category: req.query.category || undefined,
        language: req.query.language || undefined,
        territoryId: req.query.territoryId || undefined,
        includeInactive,
      })
      res.json({ templates })
    } catch (err) {
      respondError(res, err)
    }
  })

  // Resolve MUST be declared before /:id, or Express matches 'resolve' as
  // an id. Every static-segment route on this prefix belongs above the
  // catch-all /:id below for the same reason.
  app.get('/api/admin/message-templates/resolve', readGuards, async (req, res) => {
    try {
      if (!req.query.code) return res.status(400).json({ error: 'code query parameter is required', code: 'MISSING_CODE' })
      const template = await resolveTemplate({
        code: String(req.query.code),
        language: req.query.language ? String(req.query.language) : undefined,
        territoryId: req.query.territoryId ? String(req.query.territoryId) : undefined,
      })
      res.json({ template })
    } catch (err) {
      respondError(res, err)
    }
  })

  app.get('/api/admin/message-templates/:id', readGuards, async (req, res) => {
    try {
      const template = await getTemplate(req.params.id)
      if (!template) return res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' })
      res.json({ template })
    } catch (err) {
      respondError(res, err)
    }
  })

  app.get('/api/admin/message-templates/:id/versions', readGuards, async (req, res) => {
    try {
      const template = await getTemplate(req.params.id)
      if (!template) return res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' })
      const versions = await getVersionHistory(req.params.id)
      res.json({ current_version: template.version, versions })
    } catch (err) {
      respondError(res, err)
    }
  })

  // -------- MUTATIONS --------

  app.post('/api/admin/message-templates', writeGuards, validate(createSchema), async (req, res) => {
    try {
      const created = await createTemplate(req.validated, { id: req.user.id })
      await activity({
        type: 'platform_template_created',
        agent_id: req.user.id,
        meta: { template_id: created.id, code: created.code, language: created.language, territory_id: created.territory_id },
      })
      res.status(201).json({ template: created })
    } catch (err) {
      respondError(res, err)
    }
  })

  app.patch('/api/admin/message-templates/:id', writeGuards, validate(updateSchema), async (req, res) => {
    try {
      const updated = await updateTemplate(req.params.id, req.validated, { id: req.user.id })
      await activity({
        type: 'platform_template_updated',
        agent_id: req.user.id,
        meta: { template_id: updated.id, code: updated.code, new_version: updated.version, change_note: req.validated.change_note || null },
      })
      res.json({ template: updated })
    } catch (err) {
      respondError(res, err)
    }
  })

  app.post('/api/admin/message-templates/:id/revert', writeGuards, validate(revertSchema), async (req, res) => {
    try {
      const reverted = await revertTemplateToVersion(req.params.id, req.validated.version, { id: req.user.id })
      await activity({
        type: 'platform_template_reverted',
        agent_id: req.user.id,
        meta: { template_id: reverted.id, code: reverted.code, reverted_to_version: req.validated.version, new_version: reverted.version },
      })
      res.json({ template: reverted })
    } catch (err) {
      respondError(res, err)
    }
  })

  app.delete('/api/admin/message-templates/:id', writeGuards, async (req, res) => {
    try {
      // Snapshot metadata BEFORE the delete so the activity log is
      // still meaningful — the row is gone by the time we log.
      const template = await getTemplate(req.params.id)
      if (!template) return res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' })
      await deleteTemplate(req.params.id)
      await activity({
        type: 'platform_template_deleted',
        agent_id: req.user.id,
        meta: { template_id: template.id, code: template.code, language: template.language, territory_id: template.territory_id },
      })
      res.json({ deleted: true })
    } catch (err) {
      respondError(res, err)
    }
  })

  // -------- PREVIEW + TEST SEND --------

  // Preview is a read-shaped operation and doesn't require elevation. It
  // renders in memory and returns; no side effects.
  app.post('/api/admin/message-templates/:id/preview', readGuards, validate(previewSchema), async (req, res) => {
    try {
      const template = await getTemplate(req.params.id)
      if (!template) return res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' })
      const result = previewTemplate(template, req.validated.variables)
      res.json({ template_id: template.id, ...result })
    } catch (err) {
      respondError(res, err)
    }
  })

  // Test-send actually leaves the building. Elevation-gated AND locked
  // to the caller's own email address — an admin who wants to try a
  // draft on a customer address must save and let the real send site
  // pick it up. Otherwise this endpoint becomes a "spam anyone from a
  // trusted domain" tool.
  app.post('/api/admin/message-templates/:id/test-send', writeGuards, validate(testSendSchema), async (req, res) => {
    try {
      const template = await getTemplate(req.params.id)
      if (!template) return res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' })

      const callerEmail = String(req.user.email || '').toLowerCase().trim()
      const requestedTo = String(req.validated.to).toLowerCase().trim()
      if (!callerEmail || callerEmail !== requestedTo) {
        return res.status(403).json({
          error: 'Test sends may only be delivered to the caller\'s own email address',
          code: 'TEST_SEND_SELF_ONLY',
        })
      }

      if (template.channel !== 'email') {
        return res.status(400).json({
          error: `Test-send is only implemented for email templates (channel=${template.channel})`,
          code: 'TEST_SEND_UNSUPPORTED_CHANNEL',
        })
      }

      const { rendered } = previewTemplate(template, req.validated.variables)
      const result = await sendEmail({
        to: callerEmail,
        subject: `[TEST] ${rendered.subject}`,
        body: rendered.text_body || undefined,
        html: rendered.html_body || undefined,
      })
      await activity({
        type: 'platform_template_test_sent',
        agent_id: req.user.id,
        meta: { template_id: template.id, code: template.code, provider: result.provider, provider_message_id: result.provider_message_id },
      })
      res.json({ sent: true, provider: result.provider, provider_message_id: result.provider_message_id })
    } catch (err) {
      respondError(res, err)
    }
  })

}

export const __testables = { statusForError, previewTemplate, requireExplicitPlatformAdmin }
