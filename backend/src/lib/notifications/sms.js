/**
 * SMS dispatcher (Twilio). Throws SMS_UNCONFIGURED when creds are missing.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (E.164).
 */

import { v4 as uuidv4 } from 'uuid'

function normalizePhone(phone) {
  if (!phone) return ''
  return String(phone).replace(/\D/g, '')
}

export function getSMSConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: normalizePhone(process.env.TWILIO_PHONE_NUMBER || ''),
  }
}

export function isSMSEnabled() {
  const cfg = getSMSConfig()
  return Boolean(cfg.accountSid && cfg.authToken && cfg.fromNumber)
}

function requireSMSCreds(cfg, feature) {
  const missing = []
  if (!cfg.accountSid) missing.push('TWILIO_ACCOUNT_SID')
  if (!cfg.authToken) missing.push('TWILIO_AUTH_TOKEN')
  if (!cfg.fromNumber) missing.push('TWILIO_PHONE_NUMBER')
  if (missing.length) {
    const err = new Error(`SMS ${feature} requires ${missing.join(', ')} to be set`)
    err.code = 'SMS_UNCONFIGURED'
    throw err
  }
}

export async function sendSMS({ to, body }) {
  const cfg = getSMSConfig()
  const phone = normalizePhone(to)
  if (!phone) throw Object.assign(new Error('Recipient phone number is required'), { code: 'MISSING_RECIPIENT' })
  if (!body?.trim()) throw Object.assign(new Error('Message body is required'), { code: 'MISSING_BODY' })
  requireSMSCreds(cfg, 'send')

  // Twilio live path
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`
  const params = new URLSearchParams({
    To: `+${phone}`,
    From: `+${cfg.fromNumber}`,
    Body: body.trim(),
  })

  const res = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.message || `Twilio SMS error (${res.status})`)
    err.code = data?.code || `TWILIO_${res.status}`
    err.details = data
    throw err
  }

  return {
    ok: true,
    provider: 'twilio',
    provider_message_id: data.sid || null,
    to: data.to || phone,
    body: data.body || body.trim(),
    status: data.status || 'queued',
  }
}

/**
 * Parse a Twilio inbound SMS webhook payload.
 * Twilio sends form-encoded or JSON data depending on configuration.
 */
export function parseIncomingSMSWebhook(payload) {
  const from = normalizePhone(payload?.From || payload?.from)
  const to = normalizePhone(payload?.To || payload?.to)
  const text = String(payload?.Body || payload?.body || '').trim()
  const messageSid = payload?.MessageSid || payload?.MessageSid || payload?.message_sid || `sms_inbound_${uuidv4().slice(0, 12)}`
  const numMedia = Number(payload?.NumMedia || payload?.num_media || 0)

  if (!from) return []

  const events = [{
    type: 'message',
    provider: 'twilio',
    from,
    to,
    message_id: messageSid,
    text,
    num_media: numMedia,
    raw_type: numMedia > 0 ? 'media' : 'text',
  }]

  return events
}

/**
 * Parse Twilio status callback payloads for delivery/read receipts.
 */
export function parseSMSStatusWebhook(payload) {
  const messageSid = payload?.MessageSid || payload?.message_sid
  const status = payload?.MessageStatus || payload?.message_status
  if (!messageSid || !status) return []
  return [{
    type: 'status',
    provider: 'twilio',
    message_id: messageSid,
    status: mapTwilioStatus(status),
  }]
}

function mapTwilioStatus(status) {
  const map = {
    queued: 'sent',
    sending: 'sent',
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
    undelivered: 'failed',
    receiving: 'received',
    received: 'received',
    accepted: 'sent',
    scheduled: 'sent',
  }
  return map[status] || status
}
