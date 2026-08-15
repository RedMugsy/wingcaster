import logger from './logger.js'

/**
 * Which OTP transports have all required env vars set.
 * Consulted at boot for the "unconfigured channels" warn AND at request
 * time to decide whether to send or throw.
 */
export function otpChannelsConfigured() {
  return {
    whatsapp: Boolean(process.env.META_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    email: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    gmail: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    facebook: Boolean(process.env.FACEBOOK_ACCESS_TOKEN),
  }
}

/**
 * Send an OTP to the requested channel. Throws if the transport is not
 * configured or not yet implemented. Callers must catch and surface a
 * clear user-facing error (typically 503).
 *
 * @returns {Promise<{delivered: true, channel: string, contact: string}>}
 */
export async function sendOtp({ channel, contact, code }) {
  if (!channel) throw new Error('OTP channel is required')
  if (!contact) throw new Error('OTP contact is required')
  if (!code) throw new Error('OTP code is required')

  const configured = otpChannelsConfigured()
  if (!configured[channel]) {
    const err = new Error(`OTP transport for '${channel}' is not configured on this server`)
    err.code = 'OTP_TRANSPORT_UNCONFIGURED'
    err.channel = channel
    throw err
  }

  // Real transports land here as they're implemented. Until each is
  // wired, calling them throws — this is intentional: shipping a fake
  // "delivered" response for an unimplemented channel is worse than
  // failing loudly.
  const err = new Error(`OTP transport for '${channel}' is not yet implemented`)
  err.code = 'OTP_TRANSPORT_UNIMPLEMENTED'
  err.channel = channel
  logger.error({ channel, contact }, 'OTP transport not implemented — request rejected')
  throw err
}
