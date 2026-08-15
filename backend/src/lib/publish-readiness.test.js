import { describe, expect, it, vi } from 'vitest'
import { assertPublishChannelConfigured, warnUnavailablePublishChannels } from './publish-readiness.js'
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
