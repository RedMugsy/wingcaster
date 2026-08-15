const REQUIREMENTS = {
  facebook: ['META_APP_SECRET', 'META_PAGE_TOKEN'],
  instagram: ['META_APP_SECRET', 'META_PAGE_TOKEN'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'],
  tiktok: ['TIKTOK_ACCESS_TOKEN'],
  x: ['X_BEARER_TOKEN'],
}

/**
 * Does the tenant's resolved connection already carry usable publish
 * credentials for this platform? When true, /publish-social should NOT
 * fall through to the global-env check — the tenant's own creds are
 * sufficient and env may legitimately be empty.
 *
 * - OAuth models (x, tiktok): the tenant's stored oauth_access_token.
 * - Enterprise models (facebook, instagram, linkedin, whatsapp): the
 *   tenant's own override token (fb/ig/li/wa_access_token_override).
 *   Without an override, the enterprise adapter needs the shared env
 *   token, so we DO fall through to assertPublishChannelConfigured.
 */
export function tenantHasPublishToken(platform, creds) {
  if (!creds) return false
  if (platform === 'x' || platform === 'tiktok') {
    return Boolean(creds.oauth_access_token)
  }
  if (platform === 'facebook') return Boolean(creds.fb_page_access_token_override)
  if (platform === 'instagram') return Boolean(creds.ig_page_access_token_override)
  if (platform === 'linkedin') return Boolean(creds.li_access_token_override)
  if (platform === 'whatsapp') return Boolean(creds.wa_access_token_override)
  return false
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
