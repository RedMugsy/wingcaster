export type PricePosition = 'below' | 'at' | 'above'
export type PricingConfidence = 'low' | 'medium' | 'high'

export interface PricingComparableSummary {
  id: string
  source: string
  source_label?: string | null
  price?: number | null
  currency?: string | null
  normalized_price: number
  similarity_score?: number | null
  weight: number
  listed_at?: string | null
  area_sqm?: number | null
  data?: {
    title?: string | null
    location?: string | null
    bedrooms?: number | null
    bathrooms?: number | null
    condition?: string | null
    source_url?: string | null
  }
}

export interface PricingAnalysis {
  id: string
  property_id: string
  match_config_id: string
  latest_run_id?: string | null
  comparable_count: number
  lowest_price: number | null
  lowest_price_property_id?: string | null
  lowest_price_comparable_type?: 'internal' | 'external' | 'agent_report' | null
  highest_price: number | null
  highest_price_property_id?: string | null
  highest_price_comparable_type?: 'internal' | 'external' | 'agent_report' | null
  median_price: number | null
  mean_price: number | null
  percentile_25: number | null
  percentile_75: number | null
  target_price: number | null
  target_percentile: number | null
  target_vs_median: PricePosition
  target_vs_median_percent: number
  confidence: PricingConfidence
  confidence_reason?: string | null
  market_context_sentence?: string | null
  currency_normalized: string
  parallel_rate_used?: number | null
  rate_source?: string | null
  rate_effective_at?: string | null
  rate_is_stale: boolean
  rate_age_hours?: number | null
  calculated_at: string
  expires_at?: string | null
  comparables_summary: PricingComparableSummary[]
}

export interface PricingTrendSnapshot {
  id: string
  area_id: string
  property_type: string
  year: number
  quarter: number
  median_price: number | null
  median_price_per_sqm: number | null
  properties_count: number
  change_from_prev_quarter_percent: number | null
  change_from_prev_year_percent: number | null
  change_24_month_percent?: number | null
  trend_direction?: 'rising' | 'stable' | 'falling' | 'insufficient_data'
  volatility_percent?: number | null
  confidence?: PricingConfidence
  confidence_reason?: string | null
}

export interface PricingPortfolioSummary {
  total_listings: number
  analyzed_listings: number
  above_market: number
  at_market: number
  below_market: number
  low_confidence: number
  stale_rate: number
  unavailable: number
}

export interface PricingPortfolioListing {
  id: string
  title?: string
  agent_id?: string
  agent_name?: string
  agency_id?: string
  area_id?: string
  area_profile_id?: string
  city?: string
  neighborhood?: string
  property_type?: string
  price?: number
  currency?: string
  status?: string
  pricing_analysis: PricingAnalysis | null
  pricing_error?: { code: string; message: string } | null
}

export interface PricingDecision {
  id: string
  property_id: string
  actor_id: string
  analysis_id?: string | null
  channel: 'web' | 'whatsapp' | 'api'
  action: 'keep_price' | 'adjust_price'
  old_price?: number | null
  new_price?: number | null
  currency?: string | null
  reason?: string | null
  created_at: string
}

export interface AgentPriceReport {
  id: string
  property_id?: string | null
  external_property_title?: string | null
  external_property_location?: string | null
  sold_price: number
  currency: string
  sold_date?: string | null
  status: 'pending' | 'verified' | 'rejected'
  notes?: string | null
  created_at: string
}

export interface AgentPricingPortfolio {
  summary: PricingPortfolioSummary
  listings: PricingPortfolioListing[]
  reports: AgentPriceReport[]
  decisions: PricingDecision[]
}

export interface AgencyPricingPortfolio extends AgentPricingPortfolio {
  agency_id: string
  my_role: string
  agents: Array<{ agent_id: string; agent_name: string } & PricingPortfolioSummary>
}

export type RecalculationJobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled'

export interface PricingRecalculationJob {
  id: string
  requested_by?: string | null
  scope_type: 'property' | 'area' | 'all'
  scope_property_id?: string | null
  scope_area_id?: string | null
  scope_property_type?: string | null
  force_recompute: boolean
  status: RecalculationJobStatus
  total_items: number
  processed_items: number
  succeeded_items: number
  failed_items: number
  last_error?: string | null
  created_at: string
  started_at?: string | null
  finished_at?: string | null
}
