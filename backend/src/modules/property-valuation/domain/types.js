export const ConfidenceLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
}

export const PricePosition = {
  BELOW: 'below',
  AT: 'at',
  ABOVE: 'above',
}

export const SourceProvider = {
  MANUAL: 'manual',
  SKELETON: 'skeleton',
  OLX_LEBANON: 'olx_lebanon',
  CONFIDENCE_RE: 'confidence_re',
  PROPERTY_FINDER_LB: 'property_finder_lb',
  GOVERNMENT_RECORDS: 'government_records',
}

export const RuleType = {
  PAYMENT_METHOD: 'payment_method',
  CONDITION: 'condition',
  FURNISHED: 'furnished',
  VIEW: 'view',
}

export const ReportReason = {
  FAKE_LISTING: 'fake_listing',
  INCORRECT_PRICE: 'incorrect_price',
  ALREADY_SOLD: 'already_sold',
  WRONG_DETAILS: 'wrong_details',
  OTHER: 'other',
}

export const ReportStatus = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  DISMISSED: 'dismissed',
  ACTIONED: 'actioned',
}

export const DEFAULT_MATCH_CONFIG = {
  same_area: true,
  same_property_type: true,
  bed_range: 1,
  bath_range: 1,
  area_range_percent: 20,
  age_range_years: 5,
  max_days_since_listed: 180,
  max_comparables: 20,
  radius_meters: 5000,
}

export const DEFAULT_NORMALIZATION_RULES = [
  // Payment method adjustments
  { rule_type: RuleType.PAYMENT_METHOD, value: 'cash', adjustment_percent: 0, description: 'No adjustment for cash price' },
  { rule_type: RuleType.PAYMENT_METHOD, value: 'bankers_check', adjustment_percent: 12, description: 'Banker\'s check typically understates true market price' },
  { rule_type: RuleType.PAYMENT_METHOD, value: 'both', adjustment_percent: 0, description: 'Use cash price when both options listed' },
  { rule_type: RuleType.PAYMENT_METHOD, value: 'unspecified', adjustment_percent: 0, description: 'Assume cash if unspecified' },

  // Condition adjustments
  { rule_type: RuleType.CONDITION, value: 'newly_renovated', adjustment_percent: 20 },
  { rule_type: RuleType.CONDITION, value: 'good', adjustment_percent: 0 },
  { rule_type: RuleType.CONDITION, value: 'fair', adjustment_percent: -15 },
  { rule_type: RuleType.CONDITION, value: 'needs_work', adjustment_percent: -30 },
  { rule_type: RuleType.CONDITION, value: 'unknown', adjustment_percent: 0 },

  // Furnished premium
  { rule_type: RuleType.FURNISHED, value: 'fully_furnished', adjustment_percent: 25 },
  { rule_type: RuleType.FURNISHED, value: 'semi_furnished', adjustment_percent: 15 },
  { rule_type: RuleType.FURNISHED, value: 'unfurnished', adjustment_percent: 0 },
  { rule_type: RuleType.FURNISHED, value: 'unknown', adjustment_percent: 0 },

  // View premium
  { rule_type: RuleType.VIEW, value: 'sea_view', adjustment_percent: 20 },
  { rule_type: RuleType.VIEW, value: 'mountain_view', adjustment_percent: 10 },
  { rule_type: RuleType.VIEW, value: 'city_view', adjustment_percent: 5 },
  { rule_type: RuleType.VIEW, value: 'no_view', adjustment_percent: 0 },
  { rule_type: RuleType.VIEW, value: 'unknown', adjustment_percent: 0 },
]

export const DEFAULT_PRICING_SOURCES = [
  {
    source: 'platform_listings',
    provider: SourceProvider.MANUAL,
    label: 'Internal platform listings',
    enabled: true,
    is_internal: true,
    requires_disclaimer: false,
    sort_order: 1,
  },
  {
    source: 'manual_entry',
    provider: SourceProvider.MANUAL,
    label: 'Manual comparable entry',
    enabled: true,
    is_internal: false,
    requires_disclaimer: false,
    sort_order: 2,
  },
  {
    source: 'olx_lebanon',
    provider: SourceProvider.SKELETON,
    label: 'OLX Lebanon',
    enabled: false,
    is_internal: false,
    requires_disclaimer: true,
    disclaimer: 'Asking price from public listing; may not reflect actual transaction price.',
    sort_order: 3,
  },
  {
    source: 'confidence_re',
    provider: SourceProvider.SKELETON,
    label: 'Confidence Real Estate',
    enabled: false,
    is_internal: false,
    requires_disclaimer: true,
    disclaimer: 'Asking price from public listing; may not reflect actual transaction price.',
    sort_order: 4,
  },
  {
    source: 'property_finder_lb',
    provider: SourceProvider.SKELETON,
    label: 'Property Finder Lebanon',
    enabled: false,
    is_internal: false,
    requires_disclaimer: true,
    disclaimer: 'Asking price from public listing; may not reflect actual transaction price.',
    sort_order: 5,
  },
  {
    source: 'government_records',
    provider: SourceProvider.SKELETON,
    label: 'Lebanese property registry',
    enabled: false,
    is_internal: false,
    requires_disclaimer: true,
    disclaimer: 'Government-registered prices are historically underreported and should not be relied upon as market value.',
    sort_order: 6,
  },
]
