export interface BrandConfig {
  name: string
  tagline: string
  logoUrl: string
  iconUrl: string
  primaryColor: string
  accentColor: string
  contactEmail: string
}

export const DEFAULT_BRAND: BrandConfig = {
  name: 'ListingClarion',
  tagline: 'The clarion call for every listing.',
  logoUrl: '/brand-logo.svg',
  iconUrl: '/brand-icon.svg',
  primaryColor: '#0F0F0F',
  accentColor: '#EAB308',
  contactEmail: '',
}
