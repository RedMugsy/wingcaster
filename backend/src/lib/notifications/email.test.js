/**
 * Unit tests for the unified email dispatcher.
 *
 * The behaviour under test is the provider-selection contract and the
 * dispatch-to-transport wiring, not any individual provider's HTTP shape —
 * transport-specific tests live alongside each transport (graph.test.js,
 * etc.). Every provider's send function is mocked so the tests never touch
 * the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

const graphMock = vi.hoisted(() => ({
  isGraphConfigured: vi.fn(),
  sendViaGraph: vi.fn(),
}))
vi.mock('./transports/graph.js', () => graphMock)

const ENV_KEYS = [
  'EMAIL_PROVIDER', 'EMAIL_FROM',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'MAIL_FROM',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
  'SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_EMAIL', 'SMTP_SECURE',
  'SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY', 'SES_FROM_EMAIL', 'SES_REGION',
]

function clearEmailEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

async function loadModule() {
  vi.resetModules()
  return await import('./email.js')
}

beforeEach(() => {
  clearEmailEnv()
  graphMock.isGraphConfigured.mockReset().mockReturnValue(false)
  graphMock.sendViaGraph.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  // Restore whatever the environment had before the file ran.
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  vi.unstubAllGlobals()
})

describe('provider auto-detection', () => {
  it('picks graph when the Graph transport reports itself configured', async () => {
    graphMock.isGraphConfigured.mockReturnValue(true)
    process.env.MAIL_FROM = 'noreply@example.com'
    const { getEmailConfig, isEmailEnabled } = await loadModule()

    expect(getEmailConfig().provider).toBe('graph')
    expect(isEmailEnabled()).toBe(true)
  })

  it('prefers graph over resend when both are set — a Graph tenant would not expect leftover keys to win', async () => {
    graphMock.isGraphConfigured.mockReturnValue(true)
    process.env.MAIL_FROM = 'noreply@example.com'
    process.env.RESEND_API_KEY = 're_leftover'
    process.env.RESEND_FROM_EMAIL = 'r@example.com'
    const { getEmailConfig } = await loadModule()

    expect(getEmailConfig().provider).toBe('graph')
  })

  it('falls through to resend when Graph is not configured', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM = 'noreply@example.com'
    const { getEmailConfig, isEmailEnabled } = await loadModule()

    expect(getEmailConfig().provider).toBe('resend')
    expect(isEmailEnabled()).toBe(true)
  })

  it('honours an explicit EMAIL_PROVIDER override even when a different one is auto-detectable', async () => {
    process.env.EMAIL_PROVIDER = 'smtp'
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_USER = 'user'
    process.env.SMTP_PASS = 'pass'
    process.env.SMTP_FROM_EMAIL = 'noreply@example.com'
    // Resend would auto-detect if allowed to.
    process.env.RESEND_API_KEY = 're_ignored'
    const { getEmailConfig } = await loadModule()

    expect(getEmailConfig().provider).toBe('smtp')
  })

  it('reports not-enabled when nothing is configured', async () => {
    const { isEmailEnabled, getEmailConfig } = await loadModule()

    expect(getEmailConfig().provider).toBeNull()
    expect(isEmailEnabled()).toBe(false)
  })

  it('reports not-enabled when a provider is picked but its own from-address is missing', async () => {
    graphMock.isGraphConfigured.mockReturnValue(true)
    // Graph transport reports "configured" (it reads its own vars), but our
    // shared config still needs to see the from address to route to it.
    // Without MAIL_FROM/EMAIL_FROM, this must be false.
    const { isEmailEnabled } = await loadModule()

    expect(isEmailEnabled()).toBe(false)
  })
})

describe('sendEmail — dispatch and validation', () => {
  async function loadEnabledGraph() {
    graphMock.isGraphConfigured.mockReturnValue(true)
    process.env.MAIL_FROM = 'noreply@example.com'
    return await loadModule()
  }

  it('rejects a missing recipient without touching any transport', async () => {
    const { sendEmail } = await loadEnabledGraph()

    await expect(sendEmail({ to: '', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'MISSING_RECIPIENT' })
    expect(graphMock.sendViaGraph).not.toHaveBeenCalled()
  })

  it('rejects an empty body-and-html without touching any transport', async () => {
    const { sendEmail } = await loadEnabledGraph()

    await expect(sendEmail({ to: 'a@example.com', subject: 's' }))
      .rejects.toMatchObject({ code: 'MISSING_BODY' })
    expect(graphMock.sendViaGraph).not.toHaveBeenCalled()
  })

  it('throws EMAIL_UNCONFIGURED with an actionable message when nothing is set', async () => {
    const { sendEmail } = await loadModule()

    await expect(sendEmail({ to: 'a@example.com', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'EMAIL_UNCONFIGURED', message: expect.stringMatching(/Graph|Resend|SMTP/i) })
  })

  it('routes to the Graph transport when the provider is graph', async () => {
    graphMock.sendViaGraph.mockResolvedValue({
      ok: true, provider: 'graph', provider_message_id: null, to: 'a@example.com', subject: 's', status: 'accepted',
    })
    const { sendEmail } = await loadEnabledGraph()

    const result = await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>hi</p>', body: 'hi', replyTo: 'r@example.com' })

    expect(graphMock.sendViaGraph).toHaveBeenCalledWith({
      to: 'a@example.com', subject: 's', body: 'hi', html: '<p>hi</p>', replyTo: 'r@example.com',
    })
    expect(result).toMatchObject({ provider: 'graph', status: 'accepted' })
  })

  it('lowercases the recipient before dispatch', async () => {
    graphMock.sendViaGraph.mockResolvedValue({ ok: true, provider: 'graph', status: 'accepted' })
    const { sendEmail } = await loadEnabledGraph()

    await sendEmail({ to: 'Agent@Example.COM', subject: 's', body: 'x' })

    expect(graphMock.sendViaGraph).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'agent@example.com' }),
    )
  })

  it('propagates a Graph transport error without wrapping', async () => {
    graphMock.sendViaGraph.mockRejectedValue(Object.assign(new Error('boom'), { code: 'GRAPH_SEND_FAILED', status: 500 }))
    const { sendEmail } = await loadEnabledGraph()

    await expect(sendEmail({ to: 'a@example.com', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'GRAPH_SEND_FAILED', status: 500 })
  })

  it('routes to Resend when the provider is resend', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM = 'noreply@example.com'
    // Resend uses fetch — respond with a canned success.
    fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'resend-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { sendEmail } = await loadModule()

    const result = await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>hi</p>', body: 'hi' })

    expect(fetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }))
    expect(result).toMatchObject({ provider: 'resend', provider_message_id: 'resend-1', status: 'accepted' })
  })
})
