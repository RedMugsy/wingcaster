/**
 * Credential encryption for multi-tenant OAuth tokens and secret overrides.
 *
 * Uses AES-256-GCM with a base64-encoded master key from
 * CREDENTIALS_ENCRYPTION_KEY. Ciphertext format is
 * `v1:<iv-base64>:<tag-base64>:<ct-base64>`.
 *
 * Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Then set CREDENTIALS_ENCRYPTION_KEY=... in the backend .env or Railway
 * service Variables tab.
 *
 * No dev fallback. If the key is missing, encryption fails loudly. Tests
 * that touch tenant credentials must set the env var explicitly.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
const FORMAT_VERSION = 'v1'

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is not configured. Generate one with '
      + '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` '
      + 'and set it in the service environment.',
    )
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== KEY_BYTES) {
    throw new Error(`CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length})`)
  }
  return buf
}

export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${FORMAT_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decryptSecret(ciphertext) {
  if (!ciphertext) return null
  const parts = String(ciphertext).split(':')
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error('Malformed encrypted secret')
  }
  const [, ivB64, tagB64, ctB64] = parts
  const key = getKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
  return pt.toString('utf8')
}

/**
 * Safe helper: decrypts if present, returns null on error (with logging up to caller).
 */
export function tryDecrypt(ciphertext) {
  try {
    return decryptSecret(ciphertext)
  } catch {
    return null
  }
}

/**
 * Which platforms use which integration model.
 *
 * enterprise = Wingcaster holds an enterprise API token (env-configured);
 *              the tenant provides their platform-specific target id
 *              (fb_page_id / ig_business_account_id / li_author_urn /
 *              wa_phone_number_id) so posts appear under the tenant's identity.
 *
 * oauth      = Per-tenant OAuth flow. The tenant clicks "Connect", authorises
 *              on the platform, we store their access + refresh tokens
 *              (encrypted) and their target user/channel id.
 */
export const PLATFORM_INTEGRATION_MODEL = {
  facebook: 'enterprise',
  instagram: 'enterprise',
  linkedin: 'enterprise',
  whatsapp: 'enterprise',
  x: 'oauth',
  tiktok: 'oauth',
}

/**
 * Which settings each platform expects on a marketplace_connection row.
 * Used by the frontend + validation on write.
 */
export const PLATFORM_CONNECTION_FIELDS = {
  facebook: {
    model: 'enterprise',
    target_fields: [
      { key: 'fb_page_id', label: 'Facebook Page ID', required: true, secret: false },
      { key: 'fb_page_access_token_override', label: 'Page Access Token (optional override)', required: false, secret: true },
    ],
  },
  instagram: {
    model: 'enterprise',
    target_fields: [
      { key: 'ig_business_account_id', label: 'Instagram Business Account ID', required: true, secret: false },
      { key: 'ig_page_access_token_override', label: 'Page Access Token (optional override)', required: false, secret: true },
    ],
  },
  linkedin: {
    model: 'enterprise',
    target_fields: [
      { key: 'li_author_urn', label: 'LinkedIn Author URN (urn:li:organization:NNN or urn:li:person:NNN)', required: true, secret: false },
      { key: 'li_access_token_override', label: 'Access Token (optional override)', required: false, secret: true },
    ],
  },
  whatsapp: {
    model: 'enterprise',
    target_fields: [
      { key: 'wa_phone_number_id', label: 'WhatsApp Phone Number ID', required: true, secret: false },
      { key: 'wa_business_account_id', label: 'WhatsApp Business Account ID', required: true, secret: false },
      { key: 'wa_access_token_override', label: 'System User Token (optional override)', required: false, secret: true },
    ],
  },
  x: {
    model: 'oauth',
    target_fields: [
      { key: 'x_handle', label: 'X handle', required: false, secret: false },
    ],
  },
  tiktok: {
    model: 'oauth',
    target_fields: [
      { key: 'tiktok_handle', label: 'TikTok handle', required: false, secret: false },
    ],
  },
}

/**
 * Extract per-tenant credentials from a marketplace_connection row's settings
 * blob and return them in a normalized shape for the publish adapters.
 * Decrypts secret fields (access tokens) transparently.
 */
export function resolveConnectionCredentials(connection) {
  if (!connection) return null
  const s = connection.settings || {}
  const creds = s.credentials || {}
  const targets = s.enterprise_targets || {}

  return {
    platform: connection.platform,
    // Enterprise targets (public IDs)
    fb_page_id: targets.fb_page_id || null,
    ig_business_account_id: targets.ig_business_account_id || null,
    li_author_urn: targets.li_author_urn || null,
    wa_phone_number_id: targets.wa_phone_number_id || null,
    wa_business_account_id: targets.wa_business_account_id || null,
    // Optional per-tenant enterprise token overrides (encrypted at rest)
    fb_page_access_token_override: tryDecrypt(targets.fb_page_access_token_override_encrypted),
    ig_page_access_token_override: tryDecrypt(targets.ig_page_access_token_override_encrypted),
    li_access_token_override: tryDecrypt(targets.li_access_token_override_encrypted),
    wa_access_token_override: tryDecrypt(targets.wa_access_token_override_encrypted),
    // OAuth tokens (encrypted at rest)
    oauth_access_token: tryDecrypt(creds.access_token_encrypted),
    oauth_refresh_token: tryDecrypt(creds.refresh_token_encrypted),
    oauth_expires_at: creds.expires_at || null,
    oauth_user_id: creds.user_id || null,
  }
}
