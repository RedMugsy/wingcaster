/**
 * Email dispatcher for the Conversation Orchestrator.
 * Supports Resend/SendGrid/SMTP/SES live modes and dev simulation mode.
 *
 * Recommended split:
 *   - Resend  -> transactional/conversation email (better deliverability, simpler API)
 *   - SendGrid -> marketing and bulk distribution campaigns later
 *
 * Env:
 *   EMAIL_PROVIDER=dev|resend|sendgrid|smtp|ses    (default: dev)
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_EMAIL
 *   SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION, SES_FROM_EMAIL
 *   EMAIL_DEV_ALWAYS_SUCCESS=true                  (default: true)
 */

import { v4 as uuidv4 } from 'uuid'

function normalizeEmail(email) {
  if (!email) return ''
  return String(email).trim().toLowerCase()
}

export function getEmailConfig() {
  return {
    provider: process.env.EMAIL_PROVIDER || 'dev',
    resendApiKey: process.env.RESEND_API_KEY || '',
    resendFrom: normalizeEmail(process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || ''),
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
    sendgridFrom: normalizeEmail(process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM || ''),
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: normalizeEmail(process.env.SMTP_FROM_EMAIL || process.env.EMAIL_FROM || ''),
    sesAccessKeyId: process.env.SES_ACCESS_KEY_ID || '',
    sesSecretAccessKey: process.env.SES_SECRET_ACCESS_KEY || '',
    sesRegion: process.env.SES_REGION || 'us-east-1',
    sesFrom: normalizeEmail(process.env.SES_FROM_EMAIL || process.env.EMAIL_FROM || ''),
    devAlwaysSuccess: process.env.EMAIL_DEV_ALWAYS_SUCCESS !== 'false',
  }
}

export function isEmailEnabled() {
  const cfg = getEmailConfig()
  if (cfg.provider === 'dev') return true
  if (cfg.provider === 'resend') return Boolean(cfg.resendApiKey && cfg.resendFrom)
  if (cfg.provider === 'sendgrid') return Boolean(cfg.sendgridApiKey && cfg.sendgridFrom)
  if (cfg.provider === 'smtp') return Boolean(cfg.smtpHost && cfg.smtpUser && cfg.smtpPass && cfg.smtpFrom)
  if (cfg.provider === 'ses') return Boolean(cfg.sesAccessKeyId && cfg.sesSecretAccessKey && cfg.sesFrom)
  return false
}

export async function sendEmail({ to, subject, body, html, replyTo }) {
  const cfg = getEmailConfig()
  const recipient = normalizeEmail(to)
  if (!recipient) throw Object.assign(new Error('Recipient email is required'), { code: 'MISSING_RECIPIENT' })
  if (!body?.trim() && !html?.trim()) throw Object.assign(new Error('Message body or html is required'), { code: 'MISSING_BODY' })

  if (cfg.provider === 'dev' || !isEmailEnabled()) {
    if (cfg.devAlwaysSuccess) {
      return {
        ok: true,
        provider: 'email_dev_simulator',
        provider_message_id: `email_dev_${uuidv4().slice(0, 12)}`,
        to: recipient,
        subject: subject || '',
        body: body || '',
        simulated: true,
      }
    }
    throw Object.assign(new Error('Email dev mode configured to fail'), { code: 'DEV_FAILURE' })
  }

  if (cfg.provider === 'resend') {
    return sendResend(cfg, { to: recipient, subject, body, html, replyTo })
  }

  if (cfg.provider === 'sendgrid') {
    return sendSendGrid(cfg, { to: recipient, subject, body, html, replyTo })
  }

  if (cfg.provider === 'smtp') {
    throw Object.assign(new Error('SMTP live provider requires nodemailer; install it or use sendgrid/ses/dev'), { code: 'SMTP_NOT_IMPLEMENTED' })
  }

  if (cfg.provider === 'ses') {
    throw Object.assign(new Error('SES live provider requires AWS SDK; install it or use sendgrid/smtp/dev'), { code: 'SES_NOT_IMPLEMENTED' })
  }

  throw Object.assign(new Error(`Unknown email provider: ${cfg.provider}`), { code: 'UNKNOWN_PROVIDER' })
}

async function sendResend(cfg, { to, subject, body, html, replyTo }) {
  const payload = {
    from: cfg.resendFrom,
    to,
    subject: subject || '',
  }
  if (html) {
    payload.text = body || ''
    payload.html = html
  } else {
    payload.text = body || ''
  }
  if (replyTo) payload.reply_to = replyTo

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(`Resend error (${res.status}): ${data?.message || JSON.stringify(data).slice(0, 200)}`)
    err.code = data?.name || `RESEND_${res.status}`
    err.details = data
    throw err
  }

  return {
    ok: true,
    provider: 'resend',
    provider_message_id: data?.id || null,
    to,
    subject: subject || '',
    status: 'accepted',
    simulated: false,
  }
}

async function sendSendGrid(cfg, { to, subject, body, html }) {
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: cfg.sendgridFrom },
    subject: subject || '',
  }
  if (html) {
    payload.content = [
      { type: 'text/plain', value: body || '' },
      { type: 'text/html', value: html },
    ]
  } else {
    payload.content = [{ type: 'text/plain', value: body || '' }]
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.sendgridApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`SendGrid error (${res.status}): ${text.slice(0, 200)}`)
    err.code = `SENDGRID_${res.status}`
    err.details = text
    throw err
  }

  // SendGrid returns 202 with the message id in the X-Message-Id header.
  const messageId = res.headers.get('X-Message-Id') || res.headers.get('x-message-id') || null
  return {
    ok: true,
    provider: 'sendgrid',
    provider_message_id: messageId,
    to,
    subject: subject || '',
    status: 'accepted',
    simulated: false,
  }
}

/**
 * Parse an inbound email webhook payload (SendGrid Inbound Parse or SES SNS).
 * For dev/tests, also accepts a simplified JSON shape.
 */
export function parseIncomingEmailWebhook(payload) {
  const headers = payload?.headers || payload?.Headers || {}
  const from = extractFromAddress(
    payload?.from || payload?.From || headers?.From || headers?.from || '',
  )
  const to = extractFromAddress(
    payload?.to || payload?.To || headers?.To || headers?.to || '',
  )
  const subject = String(payload?.subject || payload?.Subject || headers?.Subject || headers?.subject || '').trim()
  const text = String(payload?.text || payload?.Text || payload?.body || payload?.Body || '').trim()
  const html = String(payload?.html || payload?.Html || '').trim()
  const messageId =
    payload?.message_id ||
    payload?.MessageId ||
    payload?.Message_ID ||
    headers?.['Message-Id'] ||
    headers?.['message-id'] ||
    `email_inbound_${uuidv4().slice(0, 12)}`

  if (!from) return []

  return [{
    type: 'message',
    provider: 'sendgrid',
    from,
    to,
    message_id: messageId,
    subject,
    text,
    html,
    raw_type: 'email',
  }]
}

export function parseEmailStatusWebhook(payload) {
  // Resend webhook shape: { type: 'email.delivered', data: { email_id, ... } }
  const resendType = payload?.type
  if (resendType?.startsWith?.('email.')) {
    const data = payload?.data || {}
    const messageId = data?.email_id || data?.id
    if (!messageId) return []

    const statusMap = {
      'email.sent': 'sent',
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'sent',
      'email.bounced': 'failed',
      'email.complained': 'failed',
      'email.opened': 'read',
      'email.clicked': 'read',
    }

    return [{
      type: 'status',
      provider: 'resend',
      message_id: messageId,
      status: statusMap[resendType] || 'sent',
      raw_event: resendType,
    }]
  }

  // SendGrid webhook shape
  const event = payload?.event || payload?.Event || payload?.eventType
  const messageId = payload?.sg_message_id || payload?.message_id
  if (!event || !messageId) return []

  const statusMap = {
    delivered: 'delivered',
    open: 'read',
    click: 'read',
    deferred: 'sent',
    processed: 'sent',
    bounce: 'failed',
    dropped: 'failed',
    spamreport: 'failed',
    unsubscribe: 'failed',
    group_unsubscribe: 'failed',
    group_resubscribe: 'failed',
  }

  return [{
    type: 'status',
    provider: 'sendgrid',
    message_id: messageId,
    status: statusMap[event] || event,
    raw_event: event,
  }]
}

function extractFromAddress(raw) {
  if (!raw) return ''
  const str = String(raw)
  const match = str.match(/<([^>]+)>/)
  return normalizeEmail(match ? match[1] : str)
}
