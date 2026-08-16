/**
 * Unit tests for the platform-template admin API.
 *
 * These test the ROUTING contract: auth gates, elevation gates, validation
 * shape, error-code → HTTP status mapping, and the self-only rule on
 * test-send. The service layer is mocked because it has its own real-
 * Postgres coverage in service.test.js; retesting it through HTTP would
 * be duplication.
 */
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMock = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  listTemplates: vi.fn(),
  getTemplate: vi.fn(),
  getVersionHistory: vi.fn(),
  revertTemplateToVersion: vi.fn(),
  resolveTemplate: vi.fn(),
  renderTemplate: vi.fn(({ subject, html_body, text_body }, ctx) => ({
    subject: `S(${subject})`, html_body: `H(${html_body})`, text_body: `T(${text_body})`,
  })),
  findUnknownVariables: vi.fn(() => []),
  extractAllVariables: vi.fn(() => ['code', 'name']),
}))
vi.mock('./index.js', () => serviceMock)

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}))
vi.mock('../../lib/notifications/email.js', () => emailMock)

const originalSecret = process.env.JWT_SECRET

let registerPlatformTemplateAdminRoutes
let signElevatedToken

async function loadModule() {
  vi.resetModules()
  const routes = await import('./routes.js')
  registerPlatformTemplateAdminRoutes = routes.registerPlatformTemplateAdminRoutes
  const auth = await import('../../auth.js')
  signElevatedToken = auth.signElevatedToken
}

function buildApp({ user = { id: 'admin-1', email: 'admin@example.test', platform_role: 'platform_admin', token_version: 0 }, adminOk = true } = {}) {
  const app = express()
  app.use(express.json())
  registerPlatformTemplateAdminRoutes(app, {
    authMiddleware: (req, _res, next) => { if (user) req.user = user; next() },
    requirePlatformAdmin: (req, res, next) => adminOk ? next() : res.status(403).json({ error: 'Forbidden' }),
    logActivity: async () => {},
  })
  return app
}

function elevate(user = { id: 'admin-1', token_version: 0 }) {
  return signElevatedToken({ userId: user.id, tokenVersion: user.token_version })
}

beforeEach(async () => {
  process.env.JWT_SECRET = 'routes-test-secret'
  Object.values(serviceMock).forEach((fn) => typeof fn.mockReset === 'function' && fn.mockReset())
  serviceMock.renderTemplate.mockImplementation(({ subject, html_body, text_body }) => ({
    subject: `S(${subject})`, html_body: `H(${html_body})`, text_body: `T(${text_body})`,
  }))
  serviceMock.findUnknownVariables.mockReturnValue([])
  serviceMock.extractAllVariables.mockReturnValue(['code', 'name'])
  emailMock.sendEmail.mockReset()
  await loadModule()
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = originalSecret
})

describe('registration', () => {
  it('throws when authMiddleware is missing', async () => {
    const app = express()
    expect(() => registerPlatformTemplateAdminRoutes(app, { requirePlatformAdmin: () => {} }))
      .toThrow(/authMiddleware/)
  })

  it('throws when requirePlatformAdmin is missing', async () => {
    const app = express()
    expect(() => registerPlatformTemplateAdminRoutes(app, { authMiddleware: () => {} }))
      .toThrow(/requirePlatformAdmin/)
  })
})

describe('GET /api/admin/message-templates — list', () => {
  it('returns the service list with default filters', async () => {
    serviceMock.listTemplates.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    const res = await request(buildApp()).get('/api/admin/message-templates')

    expect(res.status).toBe(200)
    expect(res.body.templates).toHaveLength(2)
    // Default: active-only.
    expect(serviceMock.listTemplates).toHaveBeenCalledWith(expect.objectContaining({ includeInactive: false }))
  })

  it('passes filters through and honours includeInactive=1', async () => {
    serviceMock.listTemplates.mockResolvedValue([])
    await request(buildApp())
      .get('/api/admin/message-templates?code=signup_otp&channel=email&includeInactive=1&language=en')

    expect(serviceMock.listTemplates).toHaveBeenCalledWith(expect.objectContaining({
      code: 'signup_otp', channel: 'email', language: 'en', includeInactive: true,
    }))
  })
})

describe('GET single + versions', () => {
  it('404s when the template does not exist', async () => {
    serviceMock.getTemplate.mockResolvedValue(null)
    const res = await request(buildApp()).get('/api/admin/message-templates/nope')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND')
  })

  it('returns current version alongside history', async () => {
    serviceMock.getTemplate.mockResolvedValue({ id: 't1', version: 5 })
    serviceMock.getVersionHistory.mockResolvedValue([{ version: 4 }, { version: 3 }])
    const res = await request(buildApp()).get('/api/admin/message-templates/t1/versions')
    expect(res.status).toBe(200)
    expect(res.body.current_version).toBe(5)
    expect(res.body.versions).toHaveLength(2)
  })
})

describe('POST /api/admin/message-templates — create', () => {
  const VALID = {
    code: 'signup_otp',
    display_name: 'Signup OTP',
    channel: 'email',
    category: 'auth',
    subject: 'Your code: {{code}}',
    html_body: '<p>{{code}}</p>',
    required_variables: ['code'],
  }

  it('rejects without an elevation token', async () => {
    const res = await request(buildApp()).post('/api/admin/message-templates').send(VALID)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('step_up_required')
    expect(serviceMock.createTemplate).not.toHaveBeenCalled()
  })

  it('rejects a caller whose platform_role is not platform_admin', async () => {
    // Belt-and-braces guard defends against a widened requirePlatformAdmin.
    const app = buildApp({ user: { id: 'x', email: 'x@x.test', platform_role: 'agent', token_version: 0 } })
    const res = await request(app)
      .post('/api/admin/message-templates')
      .set('X-Elevated-Token', signElevatedToken({ userId: 'x', tokenVersion: 0 }))
      .send(VALID)
    expect(res.status).toBe(403)
    expect(serviceMock.createTemplate).not.toHaveBeenCalled()
  })

  it('creates on a valid, elevated request', async () => {
    serviceMock.createTemplate.mockResolvedValue({ id: 't1', ...VALID, version: 1 })
    const res = await request(buildApp())
      .post('/api/admin/message-templates')
      .set('X-Elevated-Token', elevate())
      .send(VALID)

    expect(res.status).toBe(201)
    expect(res.body.template.id).toBe('t1')
    expect(serviceMock.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'signup_otp' }),
      { id: 'admin-1' },
    )
  })

  it('rejects a code that is not lowercase snake_case', async () => {
    const res = await request(buildApp())
      .post('/api/admin/message-templates')
      .set('X-Elevated-Token', elevate())
      .send({ ...VALID, code: 'SignupOTP' })
    expect(res.status).toBe(400)
    expect(serviceMock.createTemplate).not.toHaveBeenCalled()
  })

  it('maps a service-side duplicate to HTTP 409', async () => {
    serviceMock.createTemplate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'DUPLICATE_TEMPLATE' }))
    const res = await request(buildApp())
      .post('/api/admin/message-templates')
      .set('X-Elevated-Token', elevate())
      .send(VALID)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DUPLICATE_TEMPLATE')
  })

  it('maps a missing-required-variables error to HTTP 400 with the list', async () => {
    serviceMock.createTemplate.mockRejectedValue(
      Object.assign(new Error('missing'), {
        code: 'TEMPLATE_MISSING_REQUIRED_VARIABLES',
        missing: ['code', 'name'],
      }),
    )
    const res = await request(buildApp())
      .post('/api/admin/message-templates')
      .set('X-Elevated-Token', elevate())
      .send(VALID)
    expect(res.status).toBe(400)
    expect(res.body.missing).toEqual(['code', 'name'])
  })
})

describe('PATCH — update', () => {
  it('requires elevation', async () => {
    const res = await request(buildApp()).patch('/api/admin/message-templates/t1').send({ subject: 'x' })
    expect(res.status).toBe(401)
  })

  it('updates on an elevated request', async () => {
    serviceMock.updateTemplate.mockResolvedValue({ id: 't1', version: 2 })
    const res = await request(buildApp())
      .patch('/api/admin/message-templates/t1')
      .set('X-Elevated-Token', elevate())
      .send({ subject: 'v2', change_note: 'sharper' })

    expect(res.status).toBe(200)
    expect(serviceMock.updateTemplate).toHaveBeenCalledWith('t1', expect.objectContaining({ subject: 'v2', change_note: 'sharper' }), { id: 'admin-1' })
  })

  it('maps TEMPLATE_NOT_FOUND to 404', async () => {
    serviceMock.updateTemplate.mockRejectedValue(Object.assign(new Error('nf'), { code: 'TEMPLATE_NOT_FOUND' }))
    const res = await request(buildApp())
      .patch('/api/admin/message-templates/x')
      .set('X-Elevated-Token', elevate())
      .send({ subject: 'x' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE', () => {
  it('requires elevation', async () => {
    const res = await request(buildApp()).delete('/api/admin/message-templates/t1')
    expect(res.status).toBe(401)
  })

  it('404s when the template is gone', async () => {
    serviceMock.getTemplate.mockResolvedValue(null)
    const res = await request(buildApp())
      .delete('/api/admin/message-templates/t1')
      .set('X-Elevated-Token', elevate())
    expect(res.status).toBe(404)
    expect(serviceMock.deleteTemplate).not.toHaveBeenCalled()
  })

  it('refuses to delete a seed template (409)', async () => {
    serviceMock.getTemplate.mockResolvedValue({ id: 't1', is_seed: true })
    serviceMock.deleteTemplate.mockRejectedValue(Object.assign(new Error('seed'), { code: 'CANNOT_DELETE_SEED_TEMPLATE' }))
    const res = await request(buildApp())
      .delete('/api/admin/message-templates/t1')
      .set('X-Elevated-Token', elevate())
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CANNOT_DELETE_SEED_TEMPLATE')
  })

  it('deletes on success', async () => {
    serviceMock.getTemplate.mockResolvedValue({ id: 't1', code: 'x', language: 'en', territory_id: null })
    serviceMock.deleteTemplate.mockResolvedValue({ deleted: true })
    const res = await request(buildApp())
      .delete('/api/admin/message-templates/t1')
      .set('X-Elevated-Token', elevate())
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
  })
})

describe('POST /revert', () => {
  it('requires elevation and a version number', async () => {
    const app = buildApp()
    expect((await request(app).post('/api/admin/message-templates/t1/revert').send({ version: 1 })).status).toBe(401)
    expect((await request(app)
      .post('/api/admin/message-templates/t1/revert')
      .set('X-Elevated-Token', elevate())
      .send({})).status).toBe(400)
  })

  it('reverts on success', async () => {
    serviceMock.revertTemplateToVersion.mockResolvedValue({ id: 't1', version: 6 })
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/revert')
      .set('X-Elevated-Token', elevate())
      .send({ version: 3 })
    expect(res.status).toBe(200)
    expect(serviceMock.revertTemplateToVersion).toHaveBeenCalledWith('t1', 3, { id: 'admin-1' })
  })

  it('maps VERSION_NOT_FOUND to 404', async () => {
    serviceMock.revertTemplateToVersion.mockRejectedValue(Object.assign(new Error('vnf'), { code: 'VERSION_NOT_FOUND' }))
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/revert')
      .set('X-Elevated-Token', elevate())
      .send({ version: 999 })
    expect(res.status).toBe(404)
  })
})

describe('POST /preview', () => {
  it('does NOT require elevation — it is a read-shaped op', async () => {
    serviceMock.getTemplate.mockResolvedValue({
      id: 't1', subject: 'v', html_body: 'v', text_body: 'v',
      required_variables: ['code'], optional_variables: [],
    })
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/preview')
      .send({ variables: { code: '123' } })

    expect(res.status).toBe(200)
    expect(res.body.rendered).toEqual({ subject: 'S(v)', html_body: 'H(v)', text_body: 'T(v)' })
    // Preview MUST NOT call the send transport.
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })

  it('reports unknown variables so the admin UI can warn', async () => {
    serviceMock.getTemplate.mockResolvedValue({ id: 't1', required_variables: [], optional_variables: [] })
    serviceMock.findUnknownVariables.mockReturnValueOnce(['mystery'])
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/preview')
      .send({ variables: {} })
    expect(res.body.unknown_variables).toEqual(['mystery'])
  })
})

describe('POST /test-send', () => {
  it('requires elevation', async () => {
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/test-send')
      .send({ to: 'admin@example.test', variables: {} })
    expect(res.status).toBe(401)
  })

  it('refuses to send to any address other than the caller\'s own', async () => {
    // THE THING THAT MATTERS: an admin cannot use this endpoint to
    // send arbitrary "test" mail from a trusted domain to a customer.
    serviceMock.getTemplate.mockResolvedValue({
      id: 't1', channel: 'email', subject: 'x', html_body: 'x', text_body: 'x',
      required_variables: [], optional_variables: [],
    })
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/test-send')
      .set('X-Elevated-Token', elevate())
      .send({ to: 'customer@example.com', variables: {} })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('TEST_SEND_SELF_ONLY')
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })

  it('sends to the caller with a [TEST] subject prefix', async () => {
    serviceMock.getTemplate.mockResolvedValue({
      id: 't1', channel: 'email', subject: 'x', html_body: 'x', text_body: 'x',
      required_variables: [], optional_variables: [],
    })
    emailMock.sendEmail.mockResolvedValue({ provider: 'graph', provider_message_id: 'gm-1' })

    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/test-send')
      .set('X-Elevated-Token', elevate())
      .send({ to: 'admin@example.test', variables: { code: '123' } })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ sent: true, provider: 'graph', provider_message_id: 'gm-1' })
    expect(emailMock.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@example.test',
      subject: expect.stringMatching(/^\[TEST\]/),
    }))
  })

  it('refuses non-email channels — SMS/WhatsApp test-send would need a different transport', async () => {
    serviceMock.getTemplate.mockResolvedValue({ id: 't1', channel: 'whatsapp' })
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/test-send')
      .set('X-Elevated-Token', elevate())
      .send({ to: 'admin@example.test', variables: {} })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('TEST_SEND_UNSUPPORTED_CHANNEL')
  })

  it('tolerates case differences between the caller email and the requested to', async () => {
    serviceMock.getTemplate.mockResolvedValue({
      id: 't1', channel: 'email', subject: 'x', html_body: 'x', text_body: 'x',
      required_variables: [], optional_variables: [],
    })
    emailMock.sendEmail.mockResolvedValue({ provider: 'graph' })
    const res = await request(buildApp())
      .post('/api/admin/message-templates/t1/test-send')
      .set('X-Elevated-Token', elevate())
      .send({ to: 'ADMIN@Example.TEST', variables: {} })
    expect(res.status).toBe(200)
  })
})

describe('GET /resolve — diagnostic', () => {
  it('requires the code query parameter', async () => {
    const res = await request(buildApp()).get('/api/admin/message-templates/resolve')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('MISSING_CODE')
  })

  it('returns whatever the resolver returns, including null', async () => {
    serviceMock.resolveTemplate.mockResolvedValue(null)
    const res = await request(buildApp()).get('/api/admin/message-templates/resolve?code=nope')
    expect(res.status).toBe(200)
    expect(res.body.template).toBeNull()
  })

  it('passes language + territory through', async () => {
    serviceMock.resolveTemplate.mockResolvedValue({ id: 't1' })
    await request(buildApp()).get('/api/admin/message-templates/resolve?code=x&language=ar&territoryId=terr-1')
    expect(serviceMock.resolveTemplate).toHaveBeenCalledWith({ code: 'x', language: 'ar', territoryId: 'terr-1' })
  })
})
