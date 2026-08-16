import logger from './logger.js'
import { getEmailConfig, isEmailEnabled, sendEmail } from './notifications/email.js'
import { sendPlatformNotification } from '../notifications/platform-templates/index.js'

/**
 * OTP delivery for account signup, sign-in, and step-up flows.
 *
 * The copy for each purpose is resolved from platform_message_templates
 * via sendPlatformNotification — so a platform admin can edit the OTP
 * email in the admin UI without a code change. Each purpose has its own
 * template code so signin and step-up wording stays independent:
 *
 *   signup   → template code 'signup_otp'
 *   signin   → 'signin_otp'
 *   stepup   → 'stepup_otp'
 *
 * Only signup_otp is seeded by migration 044; signin_otp and stepup_otp
 * fall through to the hardcoded fallback below until an admin creates
 * them. That fallback is what the whole product ran on before commit 4
 * and keeps working forever as defence in depth — an accidentally-
 * deleted seed cannot brick signup.
 *
 * WhatsApp / Messenger transports throw OTP_TRANSPORT_UNIMPLEMENTED
 * until real integrations are wired.
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

/**
 * Fallback copy for each OTP purpose. Used when a template row is
 * missing (accidentally-deleted seed) or a render fails. Keeps signup
 * working even against a database that never received migration 044.
 */
function fallbackOtpCopy({ code, purpose }) {
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

/** Template code per purpose — same mapping in one place. */
function templateCodeFor(purpose) {
  if (purpose === 'signin') return 'signin_otp'
  if (purpose === 'stepup') return 'stepup_otp'
  return 'signup_otp'
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

  try {
    const result = await sendPlatformNotification({
      code: templateCodeFor(purpose),
      to: contact,
      variables: { code },
      // Defence: an accidentally-deleted seed template must not brick
      // signup. If no template row is found the fallback keeps the
      // pre-migration behaviour verbatim.
      fallback: fallbackOtpCopy({ code, purpose }),
    })
    return {
      provider: result.provider,
      provider_message_id: result.provider_message_id,
      used_fallback: result.used_fallback,
      used_template_id: result.used_template_id,
    }
  } catch (err) {
    // Preserve the transport's specific code (GRAPH_SEND_FAILED, RESEND_403,
    // …) so ops can tell WHY it failed, but rewrap with a stable OTP code
    // so callers don't have to grep for provider strings.
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
      {
        channel, contact, purpose,
        provider: result.provider,
        provider_message_id: result.provider_message_id,
        used_template_id: result.used_template_id,
        used_fallback: result.used_fallback,
      },
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
