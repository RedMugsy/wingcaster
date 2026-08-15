import nodemailer from 'nodemailer'
import { Resend } from 'resend'
import logger from './logger.js'

/**
 * OTP delivery for account signup, sign-in, and step-up flows.
 *
 * Email delivery is the primary channel and the only one implemented
 * today. Provider is auto-selected from env:
 *   1. RESEND_API_KEY set  → Resend REST API (preferred, richer
 *                            deliverability + native webhooks).
 *   2. SMTP_HOST/USER/PASS → nodemailer SMTP (works with SendGrid,
 *                            Postmark, Amazon SES, Mailgun, Resend's
 *                            own SMTP relay, or a self-hosted server).
 *   3. Neither             → throw OTP_TRANSPORT_UNCONFIGURED.
 *
 * Swapping providers later is one env-var change — no code change.
 *
 * WhatsApp / Messenger transports throw OTP_TRANSPORT_UNIMPLEMENTED
 * until real integrations are wired.
 */

let resendClient = null
let smtpTransport = null

function getResend() {
  if (resendClient) return resendClient
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  resendClient = new Resend(apiKey)
  return resendClient
}

function getSmtpTransport() {
  if (smtpTransport) return smtpTransport
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  smtpTransport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
  return smtpTransport
}

function emailProvider() {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp'
  return null
}

function fromAddress() {
  return process.env.OTP_FROM || process.env.SMTP_FROM || process.env.RESEND_FROM || null
}

/**
 * Which OTP transports have all required env vars set. Consulted at
 * boot for the "unconfigured channels" warn AND at request time.
 */
export function otpChannelsConfigured() {
  const emailReady = Boolean(emailProvider() && fromAddress())
  return {
    email: emailReady,
    gmail: emailReady,
    whatsapp: Boolean(process.env.META_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    facebook: Boolean(process.env.FACEBOOK_ACCESS_TOKEN),
  }
}

function otpCopy({ code, purpose }) {
  const purposeLine = purpose === 'signin'
    ? 'Use this code to finish signing in:'
    : purpose === 'stepup'
      ? 'Use this code to approve the requested action:'
      : 'Use this code to verify your Wingcaster account:'
  return {
    subject: `Your Wingcaster verification code: ${code}`,
    text: `${purposeLine}\n\n    ${code}\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`,
    html: `
      <p>${purposeLine}</p>
      <p style="font-size:24px;font-weight:600;letter-spacing:4px;margin:16px 0;">${code}</p>
      <p style="color:#6b7280;font-size:13px;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    `,
  }
}

async function sendEmailOtp({ contact, code, purpose }) {
  const provider = emailProvider()
  const from = fromAddress()
  if (!provider || !from) {
    const err = new Error('Email OTP transport is not configured (need RESEND_API_KEY or SMTP_* + OTP_FROM/SMTP_FROM)')
    err.code = 'OTP_TRANSPORT_UNCONFIGURED'
    err.channel = 'email'
    throw err
  }
  const { subject, text, html } = otpCopy({ code, purpose })

  if (provider === 'resend') {
    const resend = getResend()
    const { data, error } = await resend.emails.send({
      from,
      to: contact,
      subject,
      text,
      html,
    })
    if (error) {
      const err = new Error(`Resend rejected the OTP email: ${error.message || 'unknown error'}`)
      err.code = 'OTP_TRANSPORT_FAILED'
      err.channel = 'email'
      err.cause = error
      throw err
    }
    return { provider_message_id: data?.id }
  }

  // provider === 'smtp'
  const transport = getSmtpTransport()
  const info = await transport.sendMail({ from, to: contact, subject, text, html })
  return { provider_message_id: info?.messageId }
}

/**
 * Send an OTP to the requested channel. Throws with a coded error on
 * missing config OR unimplemented transport — callers must catch and
 * surface a user-facing error (typically 503 with the code).
 *
 * @param {object} args
 * @param {'email'|'gmail'|'whatsapp'|'facebook'} args.channel
 * @param {string} args.contact - destination address/handle
 * @param {string} args.code - the OTP itself
 * @param {'signup'|'signin'|'stepup'} [args.purpose] - shapes the copy
 * @returns {Promise<{delivered: true, channel: string, provider: string}>}
 */
export async function sendOtp({ channel, contact, code, purpose = 'signup' }) {
  if (!channel) throw new Error('OTP channel is required')
  if (!contact) throw new Error('OTP contact is required')
  if (!code) throw new Error('OTP code is required')

  if (channel === 'email' || channel === 'gmail') {
    const result = await sendEmailOtp({ contact, code, purpose })
    const provider = emailProvider()
    logger.info({ channel, contact, purpose, provider, provider_message_id: result.provider_message_id }, 'OTP delivered via email')
    return { delivered: true, channel, provider }
  }

  const err = new Error(`OTP transport for '${channel}' is not yet implemented`)
  err.code = 'OTP_TRANSPORT_UNIMPLEMENTED'
  err.channel = channel
  logger.error({ channel, contact }, 'OTP transport not implemented — request rejected')
  throw err
}
