/**
 * Unit tests for sendPlatformNotification.
 *
 * The helper is small but load-bearing — every send site in the product
 * (OTP, welcome, WhatsApp guide, …) collapses onto it. The properties
 * that matter and are tested here:
 *
 *   1. Uses the template when present — no fallback.
 *   2. Falls back to hardcoded copy when the template is missing OR
 *      rendering fails, so a bad DB state cannot brick auth.
 *   3. Throws PLATFORM_TEMPLATE_MISSING when NO fallback is available —
 *      never a silent no-op for an OTP.
 *   4. Substituted values are HTML-escaped in html_body, not in
 *      subject/text (via renderTemplate, but asserted end-to-end here).
 *   5. Every send goes through the shared sendEmail transport — never
 *      through a duplicated Resend/SMTP client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}))
vi.mock('../../lib/notifications/email.js', () => emailMock)

const resolverMock = vi.hoisted(() => ({
  resolveTemplate: vi.fn(),
}))
vi.mock('./resolver.js', () => resolverMock)

let sendPlatformNotification

beforeEach(async () => {
  emailMock.sendEmail.mockReset()
  resolverMock.resolveTemplate.mockReset()
  vi.resetModules()
  const mod = await import('./send.js')
  sendPlatformNotification = mod.sendPlatformNotification
})

function stubSendOk(overrides = {}) {
  emailMock.sendEmail.mockResolvedValue({
    ok: true, provider: 'graph', provider_message_id: 'gm-1', status: 'accepted', ...overrides,
  })
}

const TEMPLATE = {
  id: 't-1',
  code: 'signup_otp',
  subject: 'Your code: {{code}}',
  html_body: '<p>Hi {{name}}, code is {{code}}</p>',
  text_body: 'Hi {{name}}, code is {{code}}',
  required_variables: ['code', 'name'],
  optional_variables: [],
}

describe('argument validation', () => {
  it('rejects a missing code', async () => {
    await expect(sendPlatformNotification({ to: 'a@b.test' }))
      .rejects.toMatchObject({ code: 'MISSING_CODE' })
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })

  it('rejects a missing recipient', async () => {
    await expect(sendPlatformNotification({ code: 'signup_otp' }))
      .rejects.toMatchObject({ code: 'MISSING_RECIPIENT' })
  })
})

describe('template resolution — happy path', () => {
  it('renders the template and sends through the shared transport', async () => {
    resolverMock.resolveTemplate.mockResolvedValue(TEMPLATE)
    stubSendOk()

    const result = await sendPlatformNotification({
      code: 'signup_otp',
      to: 'agent@example.test',
      variables: { code: '123456', name: 'Ali' },
    })

    expect(emailMock.sendEmail).toHaveBeenCalledTimes(1)
    const args = emailMock.sendEmail.mock.calls[0][0]
    expect(args.to).toBe('agent@example.test')
    expect(args.subject).toBe('Your code: 123456')
    expect(args.body).toBe('Hi Ali, code is 123456')
    expect(args.html).toBe('<p>Hi Ali, code is 123456</p>')

    expect(result).toMatchObject({
      sent: true, provider: 'graph', provider_message_id: 'gm-1',
      used_template_id: 't-1', used_fallback: false,
    })
  })

  it('HTML-escapes substituted values in html_body but not in subject or text', async () => {
    // The one guarantee that matters — an admin's `Hi {{name}}` cannot
    // become an XSS vector by a downstream `name` value.
    resolverMock.resolveTemplate.mockResolvedValue({
      ...TEMPLATE,
      subject: 'S: {{name}}',
      html_body: '<b>{{name}}</b>',
      text_body: 'T: {{name}}',
      required_variables: [],
    })
    stubSendOk()

    await sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test',
      variables: { name: '<script>alert(1)</script>' },
    })

    const args = emailMock.sendEmail.mock.calls[0][0]
    expect(args.subject).toBe('S: <script>alert(1)</script>')     // NOT escaped
    expect(args.body).toBe('T: <script>alert(1)</script>')        // NOT escaped
    expect(args.html).toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>') // escaped
  })

  it('passes the language and territoryId through to the resolver', async () => {
    resolverMock.resolveTemplate.mockResolvedValue(TEMPLATE)
    stubSendOk()

    await sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test',
      variables: { code: '1', name: 'x' },
      language: 'ar', territoryId: 'terr-sa',
    })

    expect(resolverMock.resolveTemplate).toHaveBeenCalledWith({
      code: 'signup_otp', language: 'ar', territoryId: 'terr-sa',
    })
  })

  it('reports unknown variables the template referenced but no one provided', async () => {
    resolverMock.resolveTemplate.mockResolvedValue({
      ...TEMPLATE,
      // Override subject/text too — base template contains {{code}},
      // and unknown-variable detection scans every part, so leaving
      // them intact would flag {{code}} as unknown alongside the
      // actual mystery variable and hide the assertion.
      subject: 'S: {{name}}',
      html_body: 'Hi {{name}} at {{mystery_variable}}',
      text_body: 'Hi {{name}}',
      required_variables: ['name'],
      optional_variables: [],
    })
    stubSendOk()

    const result = await sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test',
      variables: { name: 'x' },
    })

    expect(result.unknown_variables).toEqual(['mystery_variable'])
    // Sent anyway — unknown variables render as blank and are non-fatal.
    expect(emailMock.sendEmail).toHaveBeenCalled()
  })
})

describe('fallback behaviour', () => {
  const FALLBACK = {
    subject: 'FB Your code: 123',
    html: '<p>FB html</p>',
    text: 'FB text',
  }

  it('uses fallback when the resolver returns null', async () => {
    resolverMock.resolveTemplate.mockResolvedValue(null)
    stubSendOk()

    const result = await sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test',
      variables: { code: '123' },
      fallback: FALLBACK,
    })

    const args = emailMock.sendEmail.mock.calls[0][0]
    expect(args.subject).toBe('FB Your code: 123')
    expect(args.html).toBe('<p>FB html</p>')
    expect(result).toMatchObject({ used_template_id: null, used_fallback: true })
  })

  it('uses fallback when the resolver itself throws — a DB blip must not brick signup', async () => {
    resolverMock.resolveTemplate.mockRejectedValue(new Error('db down'))
    stubSendOk()

    const result = await sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test',
      variables: {}, fallback: FALLBACK,
    })

    expect(result.used_fallback).toBe(true)
    expect(emailMock.sendEmail).toHaveBeenCalled()
  })

  it('throws PLATFORM_TEMPLATE_MISSING when template AND fallback are both absent', async () => {
    // Auth OTPs would rather 500 than send nothing. Silence for a
    // signup verification code looks like a working platform until the
    // user tries to verify.
    resolverMock.resolveTemplate.mockResolvedValue(null)

    await expect(sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test', variables: {},
    })).rejects.toMatchObject({
      code: 'PLATFORM_TEMPLATE_MISSING',
      template_code: 'signup_otp',
      reason: 'template_not_found',
    })
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })
})

describe('transport errors', () => {
  it('propagates a send failure — the transport error is not swallowed', async () => {
    resolverMock.resolveTemplate.mockResolvedValue(TEMPLATE)
    emailMock.sendEmail.mockRejectedValue(Object.assign(new Error('smtp boom'), { code: 'GRAPH_SEND_FAILED' }))

    await expect(sendPlatformNotification({
      code: 'signup_otp', to: 'a@b.test',
      variables: { code: '1', name: 'x' },
    })).rejects.toMatchObject({ code: 'GRAPH_SEND_FAILED' })
  })
})
