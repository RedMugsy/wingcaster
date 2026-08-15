const REQUIREMENTS = {
  facebook: ['META_APP_SECRET', 'META_PAGE_TOKEN'],
  instagram: ['META_APP_SECRET', 'META_PAGE_TOKEN'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'],
  tiktok: ['TIKTOK_ACCESS_TOKEN'],
  x: ['X_BEARER_TOKEN'],
}

export function missingPublishCredentials(channel, env = process.env) {
  return (REQUIREMENTS[channel] || []).filter((name) => !env[name])
}

export function unavailablePublishChannels(env = process.env) {
  return Object.keys(REQUIREMENTS).filter((channel) => missingPublishCredentials(channel, env).length > 0)
}

export function warnUnavailablePublishChannels(logger, env = process.env) {
  const channels = unavailablePublishChannels(env)
  if (channels.length) {
    logger.warn({ channels }, 'Publishing channels are unavailable until required credentials are configured')
  }
  return channels
}

export function assertPublishChannelConfigured(channel, env = process.env) {
  const missing = missingPublishCredentials(channel, env)
  if (!missing.length) return
  throw Object.assign(
    new Error(`${channel} publishing requires ${missing.join(' and ')} to be set`),
    { code: 'PUBLISH_CREDENTIALS_MISSING', status: 503 },
  )
}
