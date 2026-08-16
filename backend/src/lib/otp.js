import logger from './logger.js'
import { getEmailConfig, isEmailEnabled, sendEmail } from './notifications/email.js'

/**
 * OTP delivery for account signup, sign-in, and step-up flows.
 *
 * Every OTP goes through the unified transport in
 * `lib/notifications/email.js`. This module used to keep its own Resend and
 * nodemailer clients and its own OTP_FROM/SMTP_FROM/RESEND_FROM env vars —
 * three code paths and three from-address conventions for the same operation.
 * The upcoming platform-notification system needs one shared surface, and the
 * Microsoft Graph transport lands there rather than being duplicated here.
 *
 * The hardcoded copy below is a temporary default. It becomes an editable
 * platform_message_template in the next commits; wiring here does not change
 * when it does, only the source of `subject` / `text` / `html`.
 *
 * WhatsApp / Messenger transports throw OTP_TRANSPORT_UNIMPLEMENTED until
 * real integrations are wired.
 */

/**
 * Which OTP transports have all required env vars set. Consulted at boot for
 * the "unconfigured channels" warn AND at request time.
 */
export function otpChannelsConfigured() {
  const emailReady = isEmailEnabled()
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
  if (!isEmailEnabled()) {
    const err = new Error(
      'Email OTP transport is not configured '
        + '(set AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET + MAIL_FROM for Microsoft Graph, '
        + 'or RESEND_API_KEY / SMTP_* + EMAIL_FROM for another provider)',
    )
    err.code = 'OTP_TRANSPORT_UNCONFIGURED'
    err.channel = 'email'
    throw err
  }
  const { subject, text, html } = otpCopy({ code, purpose })

  try {
    const result = await sendEmail({ to: contact, subject, body: text, html })
    return { provider: result.provider, provider_message_id: result.provider_message_id }
  } catch (err) {
    // Preserve the transport's specific code (GRAPH_SEND_FAILED, RESEND_403,
    // …) so ops can tell WHY it failed, but rewrap with a stable OTP code so
    // callers don't have to grep for provider strings.
    const wrapped = new Error(`OTP email send failed: ${err.message}`)
    wrapped.code = 'OTP_TRANSPORT_FAILED'
    wrapped.channel = 'email'
    wrapped.transport_code = err.code
    wrapped.cause = err
    throw wrapped
  }
}

/**
 * Send an OTP to the requested channel. Throws with a coded error on missing
 * config OR unimplemented transport — callers must catch and surface a
 * user-facing error (typically 503 with the code).
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
    logger.info(
      { channel, contact, purpose, provider: result.provider, provider_message_id: result.provider_message_id },
      'OTP delivered via email',
    )
    return { delivered: true, channel, provider: result.provider }
  }

  const err = new Error(`OTP transport for '${channel}' is not yet implemented`)
  err.code = 'OTP_TRANSPORT_UNIMPLEMENTED'
  err.channel = channel
  logger.error({ channel, contact }, 'OTP transport not implemented — request rejected')
  throw err
}

/** Re-exported for tests and diagnostics that used to peek at getEmailConfig. */
export { getEmailConfig }
