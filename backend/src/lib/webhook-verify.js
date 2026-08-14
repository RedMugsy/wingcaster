import { createHmac, createPublicKey, timingSafeEqual, verify as verifyAsymmetric } from 'node:crypto'

const bodyBuffer = (body) => Buffer.isBuffer(body)
  ? body
  : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}))

function safeEqual(actual, expected) {
  const left = Buffer.isBuffer(actual) ? actual : Buffer.from(String(actual || ''))
  const right = Buffer.isBuffer(expected) ? expected : Buffer.from(String(expected || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

function timestampError(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value)) return 'Missing or invalid webhook timestamp'
  const seconds = value > 1e12 ? value / 1000 : value
  const configured = Number(process.env.WEBHOOK_TIMESTAMP_WINDOW_SECONDS || 300)
  const windowSeconds = Number.isFinite(configured) && configured > 0 ? configured : 300
  return Math.abs(Date.now() / 1000 - seconds) > windowSeconds
    ? 'Webhook timestamp is outside the permitted window'
    : null
}

function hmacResult({ algorithm, secret, payload, signature, encoding, prefix = '' }) {
  if (!secret) return { ok: false, error: 'Webhook secret is not configured' }
  if (!signature) return { ok: false, error: 'Missing webhook signature' }
  const expected = `${prefix}${createHmac(algorithm, secret).update(payload).digest(encoding)}`
  return safeEqual(signature, expected)
    ? { ok: true }
    : { ok: false, error: 'Invalid webhook signature' }
}

export function verifyMetaSignature({ rawBody, signature, appSecret }) {
  return hmacResult({
    algorithm: 'sha256', secret: appSecret, payload: bodyBuffer(rawBody),
    signature, encoding: 'hex', prefix: 'sha256=',
  })
}

export function verifyTikTokSignature({ rawBody, signature, timestamp, appSecret }) {
  const parts = Object.fromEntries(String(signature || '').split(',').map((part) => part.trim().split('=')))
  const eventTimestamp = timestamp || parts.t
  const error = timestampError(eventTimestamp)
  if (error) return { ok: false, error }
  return hmacResult({
    algorithm: 'sha256', secret: appSecret,
    payload: Buffer.concat([Buffer.from(`${eventTimestamp}.`), bodyBuffer(rawBody)]),
    signature: parts.s || signature, encoding: 'hex',
  })
}

export function verifyXSignature({ rawBody, signature, timestamp, appSecret }) {
  if (timestamp != null && timestamp !== '') {
    const error = timestampError(timestamp)
    if (error) return { ok: false, error }
  }
  return hmacResult({
    algorithm: 'sha256', secret: appSecret, payload: bodyBuffer(rawBody),
    signature, encoding: 'base64', prefix: 'sha256=',
  })
}

function twilioParams(rawBody) {
  if (rawBody && !Buffer.isBuffer(rawBody) && typeof rawBody === 'object') return rawBody
  const text = bodyBuffer(rawBody).toString('utf8')
  if (text.trim().startsWith('{')) return JSON.parse(text)
  const params = {}
  for (const [key, value] of new URLSearchParams(text)) params[key] = value
  return params
}

export function verifySmsSignature({ rawBody, signature, twilioAuthToken, url }) {
  let params
  try { params = twilioParams(rawBody) } catch { return { ok: false, error: 'Invalid SMS webhook body' } }
  const suffix = Object.keys(params).sort().map((key) => `${key}${params[key] ?? ''}`).join('')
  return hmacResult({
    algorithm: 'sha1', secret: twilioAuthToken, payload: `${url}${suffix}`,
    signature, encoding: 'base64',
  })
}

function header(headers, name) {
  const wanted = name.toLowerCase()
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wanted)
  return entry?.[1]
}

export function verifyEmailSignature({ headers, body, providerSecret, provider }) {
  if (!providerSecret) return { ok: false, error: 'Webhook secret is not configured' }
  const normalizedProvider = String(provider).toLowerCase()
  if (normalizedProvider === 'postmark') {
    const signature = header(headers, 'x-postmark-signature') || header(headers, 'x-wingcaster-webhook-signature')
    return hmacResult({
      algorithm: 'sha256', secret: providerSecret, payload: bodyBuffer(body),
      signature, encoding: 'hex', prefix: 'sha256=',
    })
  }
  if (normalizedProvider !== 'sendgrid') {
    throw new Error(`Unsupported email webhook signature provider: ${provider || 'unspecified'}`)
  }
  const signature = header(headers, 'x-twilio-email-event-webhook-signature')
  const timestamp = header(headers, 'x-twilio-email-event-webhook-timestamp')
  const error = timestampError(timestamp)
  if (error) return { ok: false, error }
  if (!signature) return { ok: false, error: 'Missing webhook signature' }
  try {
    const key = providerSecret.includes('BEGIN PUBLIC KEY')
      ? providerSecret
      : createPublicKey({ key: Buffer.from(providerSecret, 'base64'), format: 'der', type: 'spki' })
    const valid = verifyAsymmetric(
      'sha256', Buffer.concat([Buffer.from(String(timestamp)), bodyBuffer(body)]),
      key, Buffer.from(signature, 'base64'),
    )
    return safeEqual(Buffer.from([valid ? 1 : 0]), Buffer.from([1]))
      ? { ok: true }
      : { ok: false, error: 'Invalid webhook signature' }
  } catch {
    return { ok: false, error: 'Invalid email webhook verification key or signature' }
  }
}
