/**
 * Platform aspect ratios + canonical output dimensions for social cards.
 *
 * Values are the recommended feed sizes as of 2026 (Meta / X / TikTok /
 * LinkedIn developer docs). We render at 2x-ish DPI so the same asset can
 * be downsampled by the platform without visible softness.
 */

export const PLATFORM_DIMENSIONS = {
  instagram_feed:    { width: 1080, height: 1080, aspect: '1:1',    label: 'Instagram feed'   },
  instagram_story:   { width: 1080, height: 1920, aspect: '9:16',   label: 'Instagram story'  },
  instagram_reel:    { width: 1080, height: 1920, aspect: '9:16',   label: 'Instagram reel'   },
  tiktok:            { width: 1080, height: 1920, aspect: '9:16',   label: 'TikTok'           },
  x:                 { width: 1600, height:  900, aspect: '16:9',   label: 'X'                },
  linkedin:          { width: 1200, height:  627, aspect: '1.91:1', label: 'LinkedIn'         },
  facebook_feed:     { width: 1200, height:  630, aspect: '1.91:1', label: 'Facebook feed'    },
  facebook_story:    { width: 1080, height: 1920, aspect: '9:16',   label: 'Facebook story'   },
}

export const PLATFORM_KEYS = Object.keys(PLATFORM_DIMENSIONS)

export function isValidPlatformKey(key) {
  return Object.prototype.hasOwnProperty.call(PLATFORM_DIMENSIONS, key)
}
