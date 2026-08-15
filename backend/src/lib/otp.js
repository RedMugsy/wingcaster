import nodemailer from 'nodemailer'
import logger from './logger.js'

/**
 * OTP delivery for account signup, sign-in, and step-up flows.
 *
 * Email delivery is the primary channel and the only one implemented
 * today. WhatsApp / Messenger transports throw OTP_TRANSPORT_UNIMPLEMENTED
 * until real integrations are wired.
 *
 * Email requires all of SMTP_HOST, SMTP_USER, SMTP_PASS to be set.
 * SMTP_PORT defaults to 587 (submission), SMTP_SECURE=true switches to
 * 465, SMTP_FROM controls the visible From address (defaults to the
 * SMTP_USER).
 */

let emailTransportInstance = null

function emailTransport() {
  if (emailTransportInstance) return emailTransportInstance
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  emailTransportInstance = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
  return emailTransportInstance
}

/**
 * Which OTP transports have all required env vars set. Consulted at
 * boot for the "unconfigured channels" warn AND at request time.
 */
export function otpChannelsConfigured() {
  const emailReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  return {
    email: emailReady,
    gmail: emailReady,
    whatsapp: Boolean(process.env.META_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    facebook: Boolean(process.env.FACEBOOK_ACCESS_TOKEN),
  }
}

async function sendEmailOtp({ contact, code, purpose }) {
  const transport = emailTransport()
  if (!transport) {
    const err = new Error('Email OTP transport is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)')
    err.code = 'OTP_TRANSPORT_UNCONFIGURED'
    err.channel = 'email'
    throw err
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER
  const purposeLine = purpose === 'signin'
    ? 'Use this code to finish signing in:'
    : purpose === 'stepup'
      ? 'Use this code to approve the requested action:'
      : 'Use this code to verify your Wingcaster account:'
  await transport.sendMail({
    from,
    to: contact,
    subject: `Your Wingcaster verification code: ${code}`,
    text: `${purposeLine}\n\n    ${code}\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`,
    html: `
      <p>${purposeLine}</p>
      <p style="font-size:24px;font-weight:600;letter-spacing:4px;margin:16px 0;">${code}</p>
      <p style="color:#6b7280;font-size:13px;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    `,
  })
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
 * @returns {Promise<{delivered: true, channel: string}>}
 */
export async function sendOtp({ channel, contact, code, purpose = 'signup' }) {
  if (!channel) throw new Error('OTP channel is required')
  if (!contact) throw new Error('OTP contact is required')
  if (!code) throw new Error('OTP code is required')

  if (channel === 'email' || channel === 'gmail') {
    await sendEmailOtp({ contact, code, purpose })
    logger.info({ channel, contact, purpose }, 'OTP delivered via email')
    return { delivered: true, channel }
  }

  const err = new Error(`OTP transport for '${channel}' is not yet implemented`)
  err.code = 'OTP_TRANSPORT_UNIMPLEMENTED'
  err.channel = channel
  logger.error({ channel, contact }, 'OTP transport not implemented — request rejected')
  throw err
}
