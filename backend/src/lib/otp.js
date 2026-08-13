import logger from './logger.js'

function isConfigured(channel) {
  if (channel === 'whatsapp') {
    return Boolean(process.env.META_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
  }
  if (channel === 'email' || channel === 'gmail') {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  }
  if (channel === 'facebook') {
    return Boolean(process.env.FACEBOOK_ACCESS_TOKEN)
  }
  return false
}

/**
 * Send an OTP to the requested channel.
 * Returns { delivered: boolean, simulated: boolean, message: string }.
 * In production, configure the relevant provider credentials; otherwise the
 * transport is simulated and the code is only logged (in dev) or discarded.
 */
export async function sendOtp({ channel, contact, code }) {
  const configured = isConfigured(channel)

  if (!configured) {
    logger.info({ channel, contact }, 'OTP transport not configured; simulating delivery')
    return {
      delivered: false,
      simulated: true,
      message: `OTP delivery for ${channel} is not configured on this server.`,
    }
  }

  try {
    if (channel === 'whatsapp') {
      // TODO: integrate WhatsApp Cloud API template message for OTP
      logger.info({ channel, contact }, 'WhatsApp OTP delivery not yet implemented')
    } else if (channel === 'email' || channel === 'gmail') {
      // TODO: integrate nodemailer / SMTP
      logger.info({ channel, contact }, 'Email OTP delivery not yet implemented')
    } else if (channel === 'facebook') {
      // TODO: integrate Messenger send API
      logger.info({ channel, contact }, 'Facebook OTP delivery not yet implemented')
    }

    return {
      delivered: false,
      simulated: true,
      message: `${channel} OTP provider is configured but the sending integration is not yet wired.`,
    }
  } catch (err) {
    logger.error({ err, channel, contact }, 'OTP transport error')
    return { delivered: false, simulated: false, message: err.message || 'Delivery failed' }
  }
}
