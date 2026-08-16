/**
 * Unit tests for the OTP transport dispatcher.
 *
 * This file used to hold its own Resend + nodemailer clients and its own
 * OTP_FROM / SMTP_FROM / RESEND_FROM env-var conventions. Both have been
 * removed and OTPs now flow through the shared lib/notifications/email.js
 * dispatcher. The tests assert:
 *
 *   * the copy shape (subject/text/html) reaches the shared dispatcher
 *   * the from-address decision is delegated (no OTP-specific vars are read)
 *   * transport-level failures surface as OTP_TRANSPORT_FAILED with the
 *     original transport code preserved on `transport_code`, so ops can tell
 *     WHY the send failed
 *   * an unimplemented channel is a hard failure, not a silent no-op
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const emailMock = vi.hoisted(() => ({
  isEmailEnabled: vi.fn(),
  sendEmail: vi.fn(),
  getEmailConfig: vi.fn(() => ({ provider: 'graph' })),
}))
vi.mock('./notifications/email.js', () => emailMock)

let sendOtp
let otpChannelsConfigured

beforeEach(async () => {
  vi.resetModules()
  emailMock.isEmailEnabled.mockReset().mockReturnValue(true)
  emailMock.sendEmail.mockReset().mockResolvedValue({
    ok: true, provider: 'graph', provider_message_id: 'graph-1', to: 'a@b.test', subject: 's', status: 'accepted',
  })
  emailMock.getEmailConfig.mockReset().mockReturnValue({ provider: 'graph' })
  const mod = await import('./otp.js')
  sendOtp = mod.sendOtp
  otpChannelsConfigured = mod.otpChannelsConfigured
})

describe('otpChannelsConfigured', () => {
  it('reports email available whenever the shared dispatcher is enabled', () => {
    emailMock.isEmailEnabled.mockReturnValue(true)
    expect(otpChannelsConfigured().email).toBe(true)
    expect(otpChannelsConfigured().gmail).toBe(true)
  })

  it('reports email unavailable when the shared dispatcher is not enabled', () => {
    emailMock.isEmailEnabled.mockReturnValue(false)
    expect(otpChannelsConfigured().email).toBe(false)
  })

  it('reports whatsapp / facebook based on their own credential env vars', () => {
    const prev = { ...process.env }
    try {
      delete process.env.META_ACCESS_TOKEN
      delete process.env.FACEBOOK_ACCESS_TOKEN
      expect(otpChannelsConfigured()).toMatchObject({ whatsapp: false, facebook: false })

      process.env.META_ACCESS_TOKEN = 'x'
      process.env.WHATSAPP_PHONE_NUMBER_ID = 'y'
      process.env.FACEBOOK_ACCESS_TOKEN = 'z'
      expect(otpChannelsConfigured()).toMatchObject({ whatsapp: true, facebook: true })
    } finally {
      for (const k of ['META_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'FACEBOOK_ACCESS_TOKEN']) {
        if (prev[k] === undefined) delete process.env[k]
        else process.env[k] = prev[k]
      }
    }
  })
})

describe('sendOtp — email channel', () => {
  it('sends signup copy through the shared dispatcher', async () => {
    const result = await sendOtp({ channel: 'email', contact: 'agent@example.test', code: '123456' })

    expect(emailMock.sendEmail).toHaveBeenCalledTimes(1)
    const args = emailMock.sendEmail.mock.calls[0][0]
    expect(args.to).toBe('agent@example.test')
    expect(args.subject).toMatch(/123456/)
    expect(args.body).toMatch(/verify your Wingcaster account/i)
    expect(args.body).toMatch(/123456/)
    expect(args.html).toMatch(/123456/)
    // The reported provider is whatever the shared dispatcher returned —
    // there is no longer an OTP-specific provider decision to make here.
    expect(result).toMatchObject({ delivered: true, channel: 'email', provider: 'graph' })
  })

  it('adjusts copy for the sign-in purpose', async () => {
    await sendOtp({ channel: 'email', contact: 'a@b.test', code: '111111', purpose: 'signin' })
    const args = emailMock.sendEmail.mock.calls[0][0]
    expect(args.body).toMatch(/finish signing in/i)
  })

  it('adjusts copy for the step-up purpose', async () => {
    await sendOtp({ channel: 'email', contact: 'a@b.test', code: '222222', purpose: 'stepup' })
    const args = emailMock.sendEmail.mock.calls[0][0]
    expect(args.body).toMatch(/approve the requested action/i)
  })

  it('routes the gmail alias through the same code path', async () => {
    await sendOtp({ channel: 'gmail', contact: 'a@gmail.com', code: '333333' })
    expect(emailMock.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('throws OTP_TRANSPORT_UNCONFIGURED when the shared dispatcher is off', async () => {
    emailMock.isEmailEnabled.mockReturnValue(false)
    await expect(sendOtp({ channel: 'email', contact: 'a@b.test', code: '123456' }))
      .rejects.toMatchObject({ code: 'OTP_TRANSPORT_UNCONFIGURED', channel: 'email' })
    // Deliberately did not attempt a send.
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })

  it('wraps a transport failure as OTP_TRANSPORT_FAILED and keeps the original transport code', async () => {
    emailMock.sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('MailboxNotFound'), { code: 'GRAPH_SEND_FAILED', status: 404 }),
    )
    const promise = sendOtp({ channel: 'email', contact: 'a@b.test', code: '123456' })
    await expect(promise).rejects.toMatchObject({
      code: 'OTP_TRANSPORT_FAILED',
      channel: 'email',
      transport_code: 'GRAPH_SEND_FAILED',
    })
  })
})

describe('sendOtp — argument validation and unimplemented channels', () => {
  it('requires channel, contact, and code', async () => {
    await expect(sendOtp({ channel: '', contact: 'a', code: '1' })).rejects.toThrow(/channel/i)
    await expect(sendOtp({ channel: 'email', contact: '', code: '1' })).rejects.toThrow(/contact/i)
    await expect(sendOtp({ channel: 'email', contact: 'a', code: '' })).rejects.toThrow(/code/i)
  })

  it('refuses unimplemented channels loudly rather than silently succeeding', async () => {
    await expect(sendOtp({ channel: 'whatsapp', contact: '96170000000', code: '123456' }))
      .rejects.toMatchObject({ code: 'OTP_TRANSPORT_UNIMPLEMENTED', channel: 'whatsapp' })
    await expect(sendOtp({ channel: 'facebook', contact: 'fb.id', code: '123456' }))
      .rejects.toMatchObject({ code: 'OTP_TRANSPORT_UNIMPLEMENTED', channel: 'facebook' })
    expect(emailMock.sendEmail).not.toHaveBeenCalled()
  })
})
