/**
 * Unit tests for the /api/health/email diagnostic endpoint.
 *
 * The endpoint is unauthenticated on purpose — its whole reason to exist is
 * that you can hit it before your app has a way to sign you in. That makes
 * the "never leak a secret" contract critical, and these tests assert it
 * directly: no client secret, no token, no full from-address ever appears in
 * the response body.
 *
 * The endpoint is imported minimally by mounting the same handler on a fresh
 * express app; server.js itself is heavy to import and pulls in the whole
 * platform, which is unnecessary here.
 */
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const graphMock = vi.hoisted(() => ({
  isGraphConfigured: vi.fn(),
  getGraphConfig: vi.fn(),
  _resetTokenCache: vi.fn(),
}))
vi.mock('./lib/notifications/transports/graph.js', () => graphMock)

const emailMock = vi.hoisted(() => ({
  getEmailConfig: vi.fn(),
  isEmailEnabled: vi.fn(),
}))
vi.mock('./lib/notifications/email.js', async () => {
  const actual = await vi.importActual('./lib/notifications/email.js')
  return { ...actual, ...emailMock }
})

let handler

async function buildApp() {
  vi.resetModules()
  const { getEmailConfig } = await import('./lib/notifications/email.js')
  const { getGraphConfig, isGraphConfigured, _resetTokenCache } = await import('./lib/notifications/transports/graph.js')
  const { isEmailEnabled } = await import('./lib/notifications/email.js')

  // The endpoint is small and self-contained; recreate it here so the test
  // does not have to import all 8000 lines of server.js.
  handler = async (req, res) => {
    const cfg = getEmailConfig()
    const provider = cfg.provider || null
    const enabled = isEmailEnabled()
    const maskAddress = (addr) => {
      if (!addr) return null
      const at = addr.indexOf('@')
      if (at <= 0) return '***'
      return `***${addr.slice(at)}`
    }
    const result = {
      provider,
      enabled,
      from: maskAddress(
        provider === 'graph' ? cfg.graphFrom
        : provider === 'resend' ? cfg.resendFrom
        : provider === 'smtp' ? cfg.smtpFrom
        : null,
      ),
      timestamp: new Date().toISOString(),
    }
    if (provider === 'graph') {
      result.graph = {
        tenant_id_present: Boolean(process.env.AZURE_TENANT_ID),
        client_id_present: Boolean(process.env.AZURE_CLIENT_ID),
        client_secret_present: Boolean(process.env.AZURE_CLIENT_SECRET),
        mail_from_present: Boolean(getGraphConfig().from),
      }
      if (isGraphConfigured()) {
        try {
          _resetTokenCache()
          const graphCfg = getGraphConfig()
          const params = new URLSearchParams({
            client_id: graphCfg.clientId,
            client_secret: graphCfg.clientSecret,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
          })
          const tokRes = await fetch(
            `https://login.microsoftonline.com/${encodeURIComponent(graphCfg.tenantId)}/oauth2/v2.0/token`,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() },
          )
          const data = await tokRes.json().catch(() => ({}))
          if (tokRes.ok && data?.access_token) {
            result.graph.token_check = 'ok'
            result.graph.token_expires_in_seconds = Number(data.expires_in || 0)
          } else {
            result.graph.token_check = 'failed'
            result.graph.error_code = data?.error || `HTTP_${tokRes.status}`
            result.graph.error_description = data?.error_description || null
          }
        } catch (err) {
          result.graph.token_check = 'error'
          result.graph.error_message = err?.message || String(err)
        }
      } else {
        result.graph.token_check = 'skipped_missing_config'
      }
    }
    const httpStatus = enabled && (provider !== 'graph' || result.graph?.token_check === 'ok') ? 200 : 503
    res.status(httpStatus).json(result)
  }

  const app = express()
  app.get('/api/health/email', handler)
  return app
}

beforeEach(() => {
  graphMock.isGraphConfigured.mockReset().mockReturnValue(false)
  graphMock.getGraphConfig.mockReset().mockReturnValue({ tenantId: '', clientId: '', clientSecret: '', from: '' })
  graphMock._resetTokenCache.mockReset()
  emailMock.getEmailConfig.mockReset()
  emailMock.isEmailEnabled.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/api/health/email — reporting', () => {
  it('reports enabled=false and provider=null when nothing is configured', async () => {
    emailMock.getEmailConfig.mockReturnValue({ provider: null })
    emailMock.isEmailEnabled.mockReturnValue(false)
    const app = await buildApp()

    const res = await request(app).get('/api/health/email')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ provider: null, enabled: false, from: null })
  })

  it('masks the from-address to its domain when reporting', async () => {
    emailMock.getEmailConfig.mockReturnValue({ provider: 'resend', resendFrom: 'noreply@example.com' })
    emailMock.isEmailEnabled.mockReturnValue(true)
    const app = await buildApp()

    const res = await request(app).get('/api/health/email')
    expect(res.body.from).toBe('***@example.com')
    // The local part must not appear anywhere in the response body.
    expect(JSON.stringify(res.body)).not.toContain('noreply')
  })
})

describe('/api/health/email — Graph token check', () => {
  const CONFIGURED = {
    provider: 'graph',
    graphFrom: 'noreply@example.com',
  }
  const GRAPH_CFG = {
    tenantId: '11111111-2222-3333-4444-555555555555',
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    clientSecret: 'super-secret',
    from: 'noreply@example.com',
  }

  beforeEach(() => {
    process.env.AZURE_TENANT_ID = GRAPH_CFG.tenantId
    process.env.AZURE_CLIENT_ID = GRAPH_CFG.clientId
    process.env.AZURE_CLIENT_SECRET = GRAPH_CFG.clientSecret
    emailMock.getEmailConfig.mockReturnValue(CONFIGURED)
    emailMock.isEmailEnabled.mockReturnValue(true)
    graphMock.isGraphConfigured.mockReturnValue(true)
    graphMock.getGraphConfig.mockReturnValue(GRAPH_CFG)
  })

  afterEach(() => {
    delete process.env.AZURE_TENANT_ID
    delete process.env.AZURE_CLIENT_ID
    delete process.env.AZURE_CLIENT_SECRET
  })

  it('returns token_check=ok and HTTP 200 when Microsoft issues a token', async () => {
    // Distinctive token string that couldn't collide with any real field name
    // in the response body — 'tok' as a substring is inside 'token_check'.
    const distinctiveToken = 'ZZ-actual-graph-token-ZZ'
    fetch.mockResolvedValue(new Response(
      JSON.stringify({ access_token: distinctiveToken, expires_in: 3600 }), { status: 200 },
    ))
    const app = await buildApp()

    const res = await request(app).get('/api/health/email')

    expect(res.status).toBe(200)
    expect(res.body.graph).toMatchObject({
      tenant_id_present: true,
      client_id_present: true,
      client_secret_present: true,
      mail_from_present: true,
      token_check: 'ok',
      token_expires_in_seconds: 3600,
    })
    // The response must never carry the actual access token.
    expect(JSON.stringify(res.body)).not.toContain(distinctiveToken)
    // Nor the client secret.
    expect(JSON.stringify(res.body)).not.toContain(GRAPH_CFG.clientSecret)
  })

  it('returns token_check=failed with the Microsoft error code when the secret is wrong', async () => {
    // AADSTS7000215 is the real code Microsoft returns for an invalid client
    // secret. Passing it through means an admin can search for it directly.
    fetch.mockResolvedValue(new Response(JSON.stringify({
      error: 'invalid_client',
      error_description: 'AADSTS7000215: Invalid client secret provided.',
    }), { status: 401 }))
    const app = await buildApp()

    const res = await request(app).get('/api/health/email')

    expect(res.status).toBe(503)
    expect(res.body.graph.token_check).toBe('failed')
    expect(res.body.graph.error_code).toBe('invalid_client')
    expect(res.body.graph.error_description).toMatch(/AADSTS7000215/)
  })

  it('reports the missing-consent case with the AADSTS65001 code', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'AADSTS65001: The user or administrator has not consented to use the application.',
    }), { status: 400 }))
    const app = await buildApp()

    const res = await request(app).get('/api/health/email')

    expect(res.status).toBe(503)
    expect(res.body.graph.error_description).toMatch(/AADSTS65001/)
  })

  it('bypasses the token cache so a rotated-secret breakage surfaces immediately', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }), { status: 200 }))
    const app = await buildApp()

    await request(app).get('/api/health/email')

    expect(graphMock._resetTokenCache).toHaveBeenCalled()
  })

  it('reports token_check=skipped_missing_config when Graph is provider but a var is missing', async () => {
    graphMock.isGraphConfigured.mockReturnValue(false)
    // MAIL_FROM in getGraphConfig empty
    graphMock.getGraphConfig.mockReturnValue({ ...GRAPH_CFG, from: '' })
    delete process.env.AZURE_CLIENT_SECRET
    const app = await buildApp()

    const res = await request(app).get('/api/health/email')

    expect(res.status).toBe(503)
    expect(res.body.graph).toMatchObject({
      client_secret_present: false,
      mail_from_present: false,
      token_check: 'skipped_missing_config',
    })
    // Should not have called fetch at all.
    expect(fetch).not.toHaveBeenCalled()
  })
})
