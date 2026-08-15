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

// ==========================================================
// Products + Tiers + Overrides (Phase 7c/1)
// ==========================================================

export type ProductType = 'plan' | 'addon' | 'bundle'
export type ProductStatus = 'draft' | 'active' | 'deprecated' | 'retired'
export type BillingCadence = 'monthly' | 'annual' | 'one_off' | '90_days' | 'custom'

export interface ProductEntitlement {
  key: string
  type: 'feature' | 'quota'
  [extra: string]: unknown
}

export interface Product {
  id: string
  code: string
  version: number
  name: string
  description: string | null
  product_type: ProductType
  billing_cadence: BillingCadence
  base_price_minor: number
  currency: string
  entitlements: ProductEntitlement[]
  bundle_items: Array<Record<string, unknown>>
  is_public: boolean
  status: ProductStatus
  published_at: string | null
  deprecated_at: string | null
  retired_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type TierStatus = 'draft' | 'active' | 'deprecated' | 'retired'

export interface ProductTier {
  id: string
  product_id: string
  product_version: number
  code: string
  name: string
  description: string | null
  sort_order: number
  price_minor: number | null
  currency: string | null
  quotas: Record<string, number>
  features: string[]
  is_public: boolean
  status: TierStatus
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PricingOverride {
  id: string
  product_id: string
  product_version: number
  tier_id: string | null
  territory_id: string
  price_minor: number
  currency: string
  active: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ProductPricePreviewResult {
  product: Product
  tier: ProductTier | null
  market: MarketContext
  price: {
    priceMinor: number | null
    currency: string | null
    source:
      | 'override_tier_territory'
      | 'override_product_territory'
      | 'tier_base'
      | 'product_base'
      | null
  }
}

// ==========================================================
// Subscriptions + Lifecycle (Phase 7c/2 + 7c/3)
// ==========================================================

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'
  | 'expired'

export interface Subscription {
  id: string
  tenant_id: string
  product_id: string
  product_version: number
  tier_id: string | null
  status: SubscriptionStatus
  territory_id: string | null
  zone_id: string | null
  rate_card_version: number | null
  cast_value_minor: number | null
  price_locked_minor: number | null
  resolved_plan_price_minor: number | null
  resolved_plan_currency: string | null
  resolved_plan_source: string | null
  billing_period_start: string | null
  billing_period_end: string | null
  trial_ends_at: string | null
  next_renewal_at: string | null
  auto_renew: boolean
  cancel_at_period_end: boolean
  cancelled_at: string | null
  cancellation_reason: string | null
  grandfathered_at: string | null
  eligible_for_migration: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type SubscriptionActorType = 'tenant' | 'admin' | 'system' | 'api'

export type SubscriptionHistoryEventType =
  | 'created'
  | 'trial_started'
  | 'trial_ended'
  | 'renewed'
  | 'upgraded'
  | 'downgraded'
  | 'migrated_version'
  | 'migrated_lateral'
  | 'grandfathered'
  | 'paused'
  | 'resumed'
  | 'past_due'
  | 'reactivated'
  | 'cancelled_at_period_end'
  | 'cancelled_immediately'
  | 'expired'

export interface SubscriptionHistoryEvent {
  id: string
  subscription_id: string
  event: SubscriptionHistoryEventType | string
  from_state: Record<string, unknown> | null
  to_state: Record<string, unknown> | null
  reason: string | null
  actor_id: string | null
  actor_type: SubscriptionActorType | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface RenewalTickSummary {
  trials_ended: number
  renewed: number
  expired: number
  credit_notes_expired: number
  errors: Array<{ subscriptionId?: string; phase: string; error: string }>
}

// ==========================================================
// Credit Notes (Phase 7c/3)
// ==========================================================

export type CreditNoteType =
  | 'proration_credit'
  | 'proration_debit'
  | 'refund'
  | 'courtesy'
  | 'promo'
  | 'manual_adjustment'

export type CreditNoteStatus = 'pending' | 'applied' | 'expired' | 'voided'

export interface CreditNote {
  id: string
  tenant_id: string
  subscription_id: string | null
  type: CreditNoteType
  amount_minor: number
  currency: string
  status: CreditNoteStatus
  applied_at: string | null
  applied_to_invoice_id: string | null
  expires_at: string | null
  reason: string | null
  actor_id: string | null
  actor_type: SubscriptionActorType | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ==========================================================
// Tenant self-serve plans catalog (Phase 7c/1 public route)
// ==========================================================

export interface TenantPlanEntry {
  product: Product
  tiers: ProductTier[]
}
