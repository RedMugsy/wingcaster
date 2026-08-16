/**
 * Unit tests for the Microsoft Graph email transport.
 *
 * All HTTP is mocked via a fetch stub — nothing here talks to Microsoft.
 * The point of the suite is to prove the transport's contract with the
 * upstream API (token endpoint, sendMail endpoint), the token-cache
 * behaviour, and the stable error codes callers rely on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

let sendViaGraph
let isGraphConfigured
let _resetTokenCache

const CONFIGURED_ENV = {
  AZURE_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  AZURE_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  AZURE_CLIENT_SECRET: 'super-secret-value',
  MAIL_FROM: 'noreply@example.com',
}

function tokenResponse(body = { access_token: 'tok-abc', expires_in: 3600 }, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sendResponse(status = 202) {
  return new Response(status === 202 ? '' : JSON.stringify({ error: { code: 'MailboxNotFound', message: 'no such mailbox' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function importModule() {
  vi.resetModules()
  const mod = await import('./graph.js')
  sendViaGraph = mod.sendViaGraph
  isGraphConfigured = mod.isGraphConfigured
  _resetTokenCache = mod._resetTokenCache
  _resetTokenCache()
}

beforeEach(async () => {
  Object.assign(process.env, CONFIGURED_ENV)
  vi.stubGlobal('fetch', vi.fn())
  await importModule()
})

afterEach(() => {
  for (const key of Object.keys(CONFIGURED_ENV)) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
  vi.unstubAllGlobals()
})

describe('isGraphConfigured', () => {
  it('is true only when all four required env vars are set', () => {
    expect(isGraphConfigured()).toBe(true)

    for (const missing of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'MAIL_FROM']) {
      const saved = process.env[missing]
      delete process.env[missing]
      expect(isGraphConfigured()).toBe(false)
      process.env[missing] = saved
    }
  })
})

describe('sendViaGraph — happy path', () => {
  it('POSTs to the tenant token endpoint with the correct grant', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(sendResponse(202))

    await sendViaGraph({ to: 'agent@example.com', subject: 'hi', body: 'plain' })

    const [tokenUrl, tokenInit] = fetch.mock.calls[0]
    expect(tokenUrl).toBe(`https://login.microsoftonline.com/${encodeURIComponent(CONFIGURED_ENV.AZURE_TENANT_ID)}/oauth2/v2.0/token`)
    expect(tokenInit.method).toBe('POST')
    expect(tokenInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    // Body is form-encoded; assert the four params rather than string equality
    // so a reordering here does not break the test.
    const params = new URLSearchParams(tokenInit.body)
    expect(params.get('client_id')).toBe(CONFIGURED_ENV.AZURE_CLIENT_ID)
    expect(params.get('client_secret')).toBe(CONFIGURED_ENV.AZURE_CLIENT_SECRET)
    expect(params.get('scope')).toBe('https://graph.microsoft.com/.default')
    expect(params.get('grant_type')).toBe('client_credentials')
  })

  it('POSTs the message to /users/{from}/sendMail with the acquired token', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(sendResponse(202))

    const result = await sendViaGraph({
      to: 'agent@example.com',
      subject: 'Verify your account',
      html: '<p>Hello</p>',
      body: 'Hello',
    })

    const [sendUrl, sendInit] = fetch.mock.calls[1]
    expect(sendUrl).toBe(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(CONFIGURED_ENV.MAIL_FROM)}/sendMail`)
    expect(sendInit.method).toBe('POST')
    expect(sendInit.headers.Authorization).toBe('Bearer tok-abc')
    const payload = JSON.parse(sendInit.body)
    // HTML wins over plain text — clients that render HTML get it.
    expect(payload.message.body).toEqual({ contentType: 'HTML', content: '<p>Hello</p>' })
    expect(payload.message.subject).toBe('Verify your account')
    expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: 'agent@example.com' } }])
    // A shared service mailbox should not accumulate every send by default.
    expect(payload.saveToSentItems).toBe(false)

    expect(result).toMatchObject({ ok: true, provider: 'graph', status: 'accepted', to: 'agent@example.com' })
  })

  it('falls back to plain text when no HTML body is provided', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(sendResponse(202))

    await sendViaGraph({ to: 'agent@example.com', subject: 's', body: 'plain only' })

    const payload = JSON.parse(fetch.mock.calls[1][1].body)
    expect(payload.message.body).toEqual({ contentType: 'Text', content: 'plain only' })
  })

  it('lowercases and trims the recipient address', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(sendResponse(202))

    await sendViaGraph({ to: '  Agent@Example.COM  ', subject: 's', body: 'x' })

    const payload = JSON.parse(fetch.mock.calls[1][1].body)
    expect(payload.message.toRecipients[0].emailAddress.address).toBe('agent@example.com')
  })

  it('honours GRAPH_SAVE_TO_SENT=true', async () => {
    process.env.GRAPH_SAVE_TO_SENT = 'true'
    await importModule()
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(sendResponse(202))

    await sendViaGraph({ to: 'agent@example.com', subject: 's', body: 'x' })

    expect(JSON.parse(fetch.mock.calls[1][1].body).saveToSentItems).toBe(true)
    delete process.env.GRAPH_SAVE_TO_SENT
  })

  it('adds replyTo when supplied', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(sendResponse(202))

    await sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x', replyTo: 'reply@example.com' })

    const payload = JSON.parse(fetch.mock.calls[1][1].body)
    expect(payload.message.replyTo).toEqual([{ emailAddress: { address: 'reply@example.com' } }])
  })
})

describe('sendViaGraph — token caching', () => {
  it('reuses a cached token across sends until it nears expiry', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendResponse(202))
      .mockResolvedValueOnce(sendResponse(202))
      .mockResolvedValueOnce(sendResponse(202))

    await sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x' })
    await sendViaGraph({ to: 'b@example.com', subject: 's', body: 'x' })
    await sendViaGraph({ to: 'c@example.com', subject: 's', body: 'x' })

    // 1 token acquisition + 3 sends; the token was not re-requested.
    expect(fetch).toHaveBeenCalledTimes(4)
    const tokenCalls = fetch.mock.calls.filter(([url]) => String(url).includes('/oauth2/v2.0/token'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('refreshes automatically on a 401 sendMail response and retries once', async () => {
    // First token, then 401, then fresh token, then 202.
    fetch
      .mockResolvedValueOnce(tokenResponse({ access_token: 'stale', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: 'expired' } }), { status: 401 }))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'fresh', expires_in: 3600 }))
      .mockResolvedValueOnce(sendResponse(202))

    const result = await sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x' })

    expect(result.ok).toBe(true)
    // The retry used the fresh token.
    expect(fetch.mock.calls[3][1].headers.Authorization).toBe('Bearer fresh')
  })

  it('gives up after one refresh, surfacing GRAPH_SEND_FAILED', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse({ access_token: 't1', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(tokenResponse({ access_token: 't2', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'Forbidden' } }), { status: 403 }))

    await expect(sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'GRAPH_SEND_FAILED', status: 403 })
  })
})

describe('sendViaGraph — errors', () => {
  it('throws GRAPH_MISCONFIGURED when a required env var is missing', async () => {
    delete process.env.MAIL_FROM
    await importModule()
    await expect(sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'GRAPH_MISCONFIGURED' })
    // And it never even attempted a network call.
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws GRAPH_TOKEN_FAILED with details when the token endpoint refuses', async () => {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_client', error_description: 'client secret wrong' }), { status: 401 }),
    )
    await expect(sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'GRAPH_TOKEN_FAILED', details: expect.objectContaining({ error: 'invalid_client' }) })
  })

  it('throws GRAPH_SEND_FAILED with the Graph error code when sendMail returns 4xx', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(sendResponse(404))

    await expect(sendViaGraph({ to: 'a@example.com', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'GRAPH_SEND_FAILED', status: 404, message: expect.stringMatching(/MailboxNotFound/) })
  })

  it('rejects a missing recipient without asking Microsoft', async () => {
    await expect(sendViaGraph({ to: '', subject: 's', body: 'x' }))
      .rejects.toMatchObject({ code: 'MISSING_RECIPIENT' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects an empty body-and-html without asking Microsoft', async () => {
    await expect(sendViaGraph({ to: 'a@example.com', subject: 's' }))
      .rejects.toMatchObject({ code: 'MISSING_BODY' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
