import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  verifyMetaSignature,
  verifyEmailSignature,
  verifySmsSignature,
  verifyTikTokSignature,
  verifyXSignature,
} from './webhook-verify.js'

const body = Buffer.from('{"event":"hello"}')

afterEach(() => { delete process.env.WEBHOOK_TIMESTAMP_WINDOW_SECONDS })

describe('verifyMetaSignature', () => {
  const secret = 'meta-secret'
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
  it('accepts a known-good signature', () => expect(verifyMetaSignature({ rawBody: body, signature, appSecret: secret }).ok).toBe(true))
  it('rejects a corrupted body', () => expect(verifyMetaSignature({ rawBody: Buffer.from('changed'), signature, appSecret: secret }).ok).toBe(false))
  it('rejects the wrong secret', () => expect(verifyMetaSignature({ rawBody: body, signature, appSecret: 'wrong' }).ok).toBe(false))
  it('rejects a missing signature', () => expect(verifyMetaSignature({ rawBody: body, appSecret: secret }).ok).toBe(false))
  it('handles a short signature without throwing', () => expect(verifyMetaSignature({ rawBody: body, signature: 'x', appSecret: secret })).toEqual(expect.objectContaining({ ok: false })))
})

describe('verifyTikTokSignature', () => {
  const secret = 'tiktok-secret'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  const signature = `t=${timestamp},s=${digest}`
  it('accepts a known-good signature', () => expect(verifyTikTokSignature({ rawBody: body, signature, appSecret: secret }).ok).toBe(true))
  it('rejects a corrupted body', () => expect(verifyTikTokSignature({ rawBody: Buffer.from('bad'), signature, appSecret: secret }).ok).toBe(false))
  it('rejects the wrong secret', () => expect(verifyTikTokSignature({ rawBody: body, signature, appSecret: 'wrong' }).ok).toBe(false))
  it('rejects an expired timestamp', () => {
    const old = String(Math.floor(Date.now() / 1000) - 301)
    const oldSig = `t=${old},s=${createHmac('sha256', secret).update(`${old}.${body}`).digest('hex')}`
    expect(verifyTikTokSignature({ rawBody: body, signature: oldSig, appSecret: secret }).ok).toBe(false)
  })
})

describe('verifyXSignature', () => {
  const secret = 'x-secret'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('base64')}`
  it('accepts a known-good signature', () => expect(verifyXSignature({ rawBody: body, signature, timestamp, appSecret: secret }).ok).toBe(true))
  it('rejects a corrupted body', () => expect(verifyXSignature({ rawBody: Buffer.from('bad'), signature, timestamp, appSecret: secret }).ok).toBe(false))
  it('rejects the wrong secret', () => expect(verifyXSignature({ rawBody: body, signature, timestamp, appSecret: 'wrong' }).ok).toBe(false))
  it('rejects an expired timestamp', () => expect(verifyXSignature({ rawBody: body, signature, timestamp: String(Number(timestamp) - 301), appSecret: secret }).ok).toBe(false))
})

describe('verifySmsSignature', () => {
  const token = 'twilio-token'
  const url = 'https://example.com/api/webhooks/sms'
  const rawBody = Buffer.from('From=%2B15551234567&Body=Hello&MessageSid=SM123')
  const payload = `${url}BodyHelloFrom+15551234567MessageSidSM123`
  const signature = createHmac('sha1', token).update(payload).digest('base64')
  it('accepts a known-good signature', () => expect(verifySmsSignature({ rawBody, signature, twilioAuthToken: token, url }).ok).toBe(true))
  it('rejects a changed URL', () => expect(verifySmsSignature({ rawBody, signature, twilioAuthToken: token, url: `${url}/changed` }).ok).toBe(false))
})

describe('verifyEmailSignature', () => {
  it('verifies a SendGrid ECDSA signature and rejects a changed body', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign('sha256', Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('base64')
    const headers = {
      'x-twilio-email-event-webhook-signature': signature,
      'x-twilio-email-event-webhook-timestamp': timestamp,
    }
    const providerSecret = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(verifyEmailSignature({ headers, body, providerSecret, provider: 'sendgrid' }).ok).toBe(true)
    expect(verifyEmailSignature({ headers, body: Buffer.from('changed'), providerSecret, provider: 'sendgrid' }).ok).toBe(false)
  })

  it('verifies a configured Postmark custom HMAC signature', () => {
    const providerSecret = 'postmark-secret'
    const signature = `sha256=${createHmac('sha256', providerSecret).update(body).digest('hex')}`
    expect(verifyEmailSignature({
      headers: { 'x-postmark-signature': signature }, body, providerSecret, provider: 'postmark',
    }).ok).toBe(true)
  })
})
