export interface BrandConfig {
  /** Product name (used in title bars, e.g. "Wingcaster"). */
  name: string
  /** Full product name including the AI qualifier ("Wingcaster AI"). */
  fullName: string
  /**
   * The three-line brand block, displayed as:
   *   Take Back Your Time.          ← taglineHero
   *   Enter it once. Cast it everywhere.   ← taglineSubhead
   *   Wingcaster AI.                ← taglineSignoff (fullName + '.')
   *
   * Individual fields so each line can be typeset independently by the
   * component (different font weights, sizes, colours) rather than
   * having to parse a single string.
   */
  taglineHero: string
  taglineSubhead: string
  taglineSignoff: string
  /** The full three-line tagline joined with newlines — convenience field. */
  tagline: string
  logoUrl: string
  iconUrl: string
  primaryColor: string
  accentColor: string
  contactEmail: string
}

const TAGLINE_HERO = 'Take Back Your Time.'
const TAGLINE_SUBHEAD = 'Enter it once. Cast it everywhere.'
const TAGLINE_SIGNOFF = 'Wingcaster AI.'

export const DEFAULT_BRAND: BrandConfig = {
  name: 'Wingcaster',
  fullName: 'Wingcaster AI',
  taglineHero: TAGLINE_HERO,
  taglineSubhead: TAGLINE_SUBHEAD,
  taglineSignoff: TAGLINE_SIGNOFF,
  tagline: `${TAGLINE_HERO}\n${TAGLINE_SUBHEAD}\n${TAGLINE_SIGNOFF}`,
  logoUrl: '/brand-logo.svg',
  iconUrl: '/brand-icon.svg',
  primaryColor: '#0F0F0F',
  accentColor: '#EAB308',
  contactEmail: '',
}
