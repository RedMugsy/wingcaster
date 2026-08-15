export type LaunchStatus = 'launched' | 'planned' | 'blocked' | 'sunset'
export type BillingMode = 'card' | 'invoice_only' | 'manual' | 'disabled'

export interface Territory {
  id: string
  code: string
  name: string | null
  currency: string | null
  pricing_multiplier: number
  launch_status: LaunchStatus
  launch_wave: number | null
  data_residency_required: boolean
  billing_mode: BillingMode
  vat_percent: number
  regulator_id_type: string | null
  default_zone_id: string | null
  payment_gateway_primary: string | null
  payment_gateway_secondary: string | null
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface Zone {
  id: string
  territory_id: string
  code: string
  name: string
  name_ar: string | null
  pricing_multiplier: number
  is_default: boolean
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface City {
  id: string
  territory_id: string
  zone_id: string | null
  name: string
  name_ar: string | null
  name_norm: string
  latitude: number | null
  longitude: number | null
  sort_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface CoreRateCard {
  id: string
  version: number
  name: string
  description: string | null
  currency: string
  cast_value_minor: number
  rates: Record<string, number>
  is_active: boolean
  activated_at: string | null
  deactivated_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MarketContext {
  territory: Territory | null
  zone: Zone | null
  source: 'explicit' | 'country_code' | 'fallback'
}

export interface PricePreview {
  casts_charged: number
  price_minor: number
  cogs_estimate_minor: number
  rate_card_version: number
  cast_value_minor: number
  effective_cast_value_minor: number
  territory_id: string | null
  zone_id: string | null
  price_locked?: boolean
}

export interface PricePreviewInput {
  country_code?: string
  city?: string
  territory_id?: string
  zone_id?: string
  action_key?: string
  quantity?: number
  whatsapp_category?: string
}

export interface ListAdminOpts {
  include_inactive?: boolean
  territory_id?: string
  zone_id?: string
}
