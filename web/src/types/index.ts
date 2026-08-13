/** Types match the API/DB snake_case payloads. */

export interface Agent {
  id: string
  name: string
  email: string
  phone: string
  license_number: string
  agency_name: string
  agency_license?: string
  photo: string
  specialization: string
  experience_since: number
  languages: string[]
  rating: number
  review_count: number
  response_time?: string
  bio?: string
  listings?: Property[]
  transactions?: Transaction[]
  verified: number | boolean
  role?: string
  slug?: string
  affiliation?: { agency_id: string; role: string; agency_name?: string } | null
}

export interface Property {
  id: string
  canonical_id?: string
  title: string
  description: string
  type: 'sale' | 'rent'
  property_type: 'apartment' | 'villa' | 'townhouse' | 'studio' | 'penthouse' | 'office' | 'shop' | string
  price: number
  price_unit?: string
  bedrooms: number
  bathrooms: number
  area: number
  area_unit: 'sqft' | 'sqm' | string
  location: string
  city: string
  neighborhood: string
  address: string
  latitude?: number | null
  longitude?: number | null
  amenities: string[]
  furnished: boolean | number
  photos: string[]
  media?: Array<{
    id?: string
    url: string
    media_type?: 'image' | 'video' | string
    classification?: string
    source?: 'link' | 'upload' | string
  }>
  developed_by?: string
  interior_design_by?: string
  floor_plan?: string
  agent_id: string
  agent_name: string
  agent_photo: string
  agent_license: string
  agency_name: string
  agency_id?: string | null
  agency_tied?: boolean | number
  listing_owner_type?: 'agency' | 'independent' | string
  marketplace_syndicated?: boolean | number
  ungroup_override?: boolean | number
  territory_id?: string
  classification?: string
  permissible_buildup_area?: number | null
  listed_date: string
  permit_number: string
  reference: string
  featured: boolean | number
  views: number
  status?: string
  offers?: Array<Partial<Property>>
}

export interface Transaction {
  id: string
  property_id: string
  location: string
  deal_type: 'sale' | 'rent'
  date: string
  property_type: string
  bedrooms: string
  price: number
  area: number
  agent_id?: string
}

export interface NeighborhoodStats {
  name: string
  city: string
  avg_price: number
  avg_size: number
  properties_listed: number
  price_min?: number
  price_max?: number
  walk_score?: number
  school_rating?: number
  transit_score?: number
  market_temp?: string
}

export interface SearchFilters {
  type?: 'sale' | 'rent'
  propertyType?: string
  city?: string
  minPrice?: number
  maxPrice?: number
  bedrooms?: number
  bathrooms?: number
  minArea?: number
  maxArea?: number
  furnished?: boolean
  amenities?: string[]
}

export interface Inquiry {
  id: string
  property_id: string
  property_title?: string
  agent_id?: string
  name: string
  email: string
  phone?: string
  message: string
  status: string
  created_at: string
  source?: string
  channel?: string
}
