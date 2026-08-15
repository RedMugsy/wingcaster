import { describe, expect, it, vi } from 'vitest'
import {
  assertPublishChannelConfigured,
  tenantHasPublishToken,
  warnUnavailablePublishChannels,
} from './publish-readiness.js'
import { publishFacebookPagePost } from './notifications/facebook.js'

describe('publish credential readiness', () => {
  it('allows boot and warns with every unconfigured channel', () => {
    const logger = { warn: vi.fn() }
    const channels = warnUnavailablePublishChannels(logger, {})

    expect(channels).toEqual(['facebook', 'instagram', 'linkedin', 'tiktok', 'x'])
    expect(logger.warn).toHaveBeenCalledWith(
      { channels },
      'Publishing channels are unavailable until required credentials are configured',
    )
  })

  it('throws a clear request-time error for an unconfigured channel', () => {
    expect(() => assertPublishChannelConfigured('facebook', {})).toThrow(
      'facebook publishing requires META_APP_SECRET and META_PAGE_TOKEN to be set',
    )
  })

  it('never returns a simulated Facebook publish without credentials', async () => {
    const previousProvider = process.env.FACEBOOK_PROVIDER
    const previousPageId = process.env.FACEBOOK_PAGE_ID
    const previousToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN
    delete process.env.FACEBOOK_PROVIDER
    delete process.env.FACEBOOK_PAGE_ID
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN

    await expect(publishFacebookPagePost({ message: 'Listing' })).rejects.toMatchObject({
      code: 'PUBLISH_CREDENTIALS_MISSING',
    })

    if (previousProvider === undefined) delete process.env.FACEBOOK_PROVIDER
    else process.env.FACEBOOK_PROVIDER = previousProvider
    if (previousPageId === undefined) delete process.env.FACEBOOK_PAGE_ID
    else process.env.FACEBOOK_PAGE_ID = previousPageId
    if (previousToken === undefined) delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN
    else process.env.FACEBOOK_PAGE_ACCESS_TOKEN = previousToken
  })
})

describe('tenantHasPublishToken', () => {
  it('returns false when creds are null / undefined', () => {
    expect(tenantHasPublishToken('facebook', null)).toBe(false)
    expect(tenantHasPublishToken('x', undefined)).toBe(false)
  })

  it('OAuth platforms need oauth_access_token', () => {
    expect(tenantHasPublishToken('x', { oauth_access_token: 'tok' })).toBe(true)
    expect(tenantHasPublishToken('tiktok', { oauth_access_token: 'tok' })).toBe(true)
    expect(tenantHasPublishToken('x', { oauth_access_token: '' })).toBe(false)
    expect(tenantHasPublishToken('tiktok', {})).toBe(false)
    // OAuth platforms must NOT be considered configured just because an
    // enterprise-style override token happens to be present.
    expect(tenantHasPublishToken('x', { fb_page_access_token_override: 'tok' })).toBe(false)
  })

  it('enterprise platforms need their platform-specific override token', () => {
    expect(tenantHasPublishToken('facebook', { fb_page_access_token_override: 'tok' })).toBe(true)
    expect(tenantHasPublishToken('instagram', { ig_page_access_token_override: 'tok' })).toBe(true)
    expect(tenantHasPublishToken('linkedin', { li_access_token_override: 'tok' })).toBe(true)
    expect(tenantHasPublishToken('whatsapp', { wa_access_token_override: 'tok' })).toBe(true)

    // A target ID alone is NOT enough — without an override token the
    // adapter needs the shared env token to publish.
    expect(tenantHasPublishToken('facebook', { fb_page_id: '123' })).toBe(false)
    expect(tenantHasPublishToken('linkedin', { li_author_urn: 'urn:li:person:1' })).toBe(false)

    // Wrong-platform overrides don't count.
    expect(tenantHasPublishToken('facebook', { ig_page_access_token_override: 'tok' })).toBe(false)
  })

  it('unknown platforms return false', () => {
    expect(tenantHasPublishToken('mastodon', { oauth_access_token: 'tok' })).toBe(false)
  })
})
