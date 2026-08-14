/**
 * Collection-to-table router for the Postgres-only DAL.
 *
 * Every `collection` argument used by business code is mapped to a real SQL
 * table (and optional schema). Known relational fields are stored as typed
 * columns; the full document is preserved in the `data` JSONB column for
 * flexibility and backwards compatibility.
 */

const ID_COLUMNS = ['id', 'created_at', 'updated_at']

const TABLE_MAP = {
  // Identity / org
  users: { schema: 'public', table: 'users', columns: ['email', 'phone', 'name', 'password_hash', 'role', 'platform_role'] },
  agents: {
    schema: 'public',
    table: 'agents',
    columns: ['user_id', 'email', 'phone', 'name', 'slug', 'agency_id', 'role', 'verified', 'subscription_features', 'cta_config'],
  },
  agencies: { schema: 'public', table: 'agencies', columns: ['owner_id', 'name', 'slug', 'license_number', 'site_hosting_type', 'cta_config'] },
  agency_members: {
    schema: 'public',
    table: 'agency_members',
    columns: ['agency_id', 'user_id', 'agent_id', 'role', 'status', 'joined_at', 'ended_at', 'end_reason'],
  },
  tenants: {
    schema: 'public',
    table: 'tenants',
    columns: ['tenant_type', 'personal_owner_user_id', 'agency_id', 'name', 'slug', 'status', 'settings'],
  },
  tenant_memberships: {
    schema: 'public',
    table: 'tenant_memberships',
    columns: [
      'tenant_id', 'user_id', 'role', 'affiliation_mode', 'status', 'public_profile', 'lead_eligible',
      'capabilities', 'legacy_agency_member_id', 'invited_by', 'joined_at', 'ended_at', 'end_reason',
    ],
  },
  tenant_lead_routing_policies: {
    schema: 'public',
    table: 'tenant_lead_routing_policies',
    columns: [
      'tenant_id', 'name', 'priority', 'strategy', 'relationship_priority', 'filters', 'eligible_members',
      'strategy_config', 'claim_timeout_seconds', 'response_timeout_seconds', 'max_attempts',
      'cooldown_seconds', 'escalation_membership_id', 'enabled', 'created_by',
    ],
  },
  contact_relationships: {
    schema: 'public',
    table: 'contact_relationships',
    columns: [
      'tenant_id', 'contact_id', 'agent_user_id', 'party_type', 'relationship_type', 'exclusivity',
      'scope', 'status', 'consent_record', 'starts_at', 'ends_at',
    ],
  },
  lead_assignments: {
    schema: 'public',
    table: 'lead_assignments',
    columns: [
      'inquiry_id', 'tenant_id', 'routing_policy_id', 'relationship_id', 'assigned_user_id', 'status',
      'attempt_number', 'offered_at', 'claim_due_at', 'claimed_at', 'response_due_at', 'responded_at',
      'ended_at', 'end_reason',
    ],
  },
  property_disposition_cases: {
    schema: 'public',
    table: 'property_disposition_cases',
    columns: [
      'property_id', 'membership_id', 'agency_tenant_id', 'personal_tenant_id', 'proposed_disposition',
      'agency_decision', 'agent_decision', 'status', 'initiated_by', 'resolved_by', 'resolution_notes',
      'resolved_at',
    ],
  },

  // Listings
  territories: {
    schema: 'public',
    table: 'territories',
    columns: [
      'code', 'name', 'currency',
      'pricing_multiplier', 'launch_status', 'launch_wave',
      'data_residency_required', 'billing_mode', 'vat_percent',
      'regulator_id_type', 'default_zone_id',
      'payment_gateway_primary', 'payment_gateway_secondary',
      'sort_order', 'active',
    ],
  },
  territory_disclosure_fields: { schema: 'public', table: 'territory_disclosure_fields', columns: ['territory_id', 'key', 'label', 'field_type', 'required', 'unit', 'sort_order'] },
  pricing_zones: {
    schema: 'public',
    table: 'pricing_zones',
    columns: [
      'territory_id', 'code', 'name', 'name_ar',
      'pricing_multiplier', 'is_default', 'sort_order', 'active',
    ],
  },
  pricing_cities: {
    schema: 'public',
    table: 'pricing_cities',
    columns: [
      'territory_id', 'zone_id', 'name', 'name_ar', 'name_norm',
      'latitude', 'longitude', 'sort_order', 'active',
    ],
  },
  core_rate_cards: {
    schema: 'public',
    table: 'core_rate_cards',
    columns: [
      'version', 'name', 'description', 'currency', 'cast_value_minor',
      'rates', 'is_active', 'activated_at', 'deactivated_at', 'created_by',
    ],
  },
  usage_events: {
    schema: 'public',
    table: 'usage_events',
    columns: [
      'tenant_id', 'subscription_id', 'action_key', 'quantity', 'channel',
      'destination_country', 'whatsapp_category', 'listing_id',
      'conversation_id', 'distribution_id', 'casts_charged', 'price_minor',
      'cogs_estimate_minor', 'rate_card_version', 'cast_value_minor',
      'territory_id', 'zone_id', 'metadata', 'billing_period', 'occurred_at',
    ],
  },
  ledger_entries: {
    schema: 'public',
    table: 'ledger_entries',
    columns: [
      'tenant_id', 'subscription_id', 'billing_period', 'type',
      'quota_key', 'amount', 'source_event_id', 'metadata',
    ],
  },
  billing_products: {
    schema: 'public',
    table: 'billing_products',
    columns: [
      'code', 'version', 'name', 'description', 'billing_cadence',
      'base_price_minor', 'currency', 'entitlements', 'bundle_items',
      'is_public', 'status',
    ],
  },
  billing_subscriptions: {
    schema: 'public',
    table: 'billing_subscriptions',
    columns: [
      'tenant_id', 'product_id', 'product_version', 'status',
      'territory_id', 'zone_id', 'rate_card_version', 'cast_value_minor',
      'price_locked_minor', 'billing_period_start', 'billing_period_end',
      'trial_ends_at', 'cancelled_at', 'metadata',
    ],
  },
  // Aliases used by billing/entitlements.js and billing/ledger.js
  subscriptions: {
    schema: 'public',
    table: 'billing_subscriptions',
    columns: [
      'tenant_id', 'product_id', 'product_version', 'status',
      'territory_id', 'zone_id', 'rate_card_version', 'cast_value_minor',
      'price_locked_minor', 'billing_period_start', 'billing_period_end',
      'trial_ends_at', 'cancelled_at', 'metadata',
    ],
  },
  products: {
    schema: 'public',
    table: 'billing_products',
    columns: [
      'code', 'version', 'name', 'description', 'billing_cadence',
      'base_price_minor', 'currency', 'entitlements', 'bundle_items',
      'is_public', 'status',
    ],
  },
  properties: {
    schema: 'public',
    table: 'properties',
    columns: [
      'agent_id', 'agency_id', 'canonical_id', 'title', 'description', 'status', 'listing_type', 'property_type',
      'price', 'price_unit', 'bedrooms', 'bathrooms', 'area', 'area_unit', 'city', 'neighborhood', 'location',
      'latitude', 'longitude', 'geom', 'territory_id', 'marketplace_syndicated', 'asset_version', 'last_asset_generated_at',
      'tenant_id', 'ownership_type', 'custody_tenant_id', 'source_user_id', 'exit_disposition',
    ],
  },
  property_media: { schema: 'public', table: 'property_media', columns: ['property_id', 'type', 'url', 'order_index', 'is_hero', 'caption'] },
  canonical_properties: { schema: 'public', table: 'canonical_properties', columns: ['primary_listing_id', 'location', 'latitude', 'longitude', 'city', 'neighborhood'] },
  price_history: { schema: 'public', table: 'price_history', columns: ['property_id', 'price', 'price_unit', 'source', 'recorded_at'] },
  neighborhood_stats: { schema: 'public', table: 'neighborhood_stats', columns: ['name', 'city', 'metric', 'value', 'updated_at'] },
  saved_searches: { schema: 'public', table: 'saved_searches', columns: ['agent_id', 'contact_id', 'name', 'filters', 'alert_settings'] },

  // CRM
  contacts: {
    schema: 'public',
    table: 'contacts',
    columns: ['email', 'phone', 'name', 'assigned_agent_id', 'agency_id', 'status', 'source', 'first_touch_channel', 'first_touch_at', 'tags', 'last_activity_at'],
  },
  contact_notes: { schema: 'public', table: 'contact_notes', columns: ['contact_id', 'agent_id', 'content'] },
  inquiries: {
    schema: 'public',
    table: 'inquiries',
    columns: ['contact_id', 'property_id', 'agent_id', 'agency_id', 'status', 'stage', 'priority', 'source', 'contact_mode', 'next_follow_up_at'],
  },
  viewings: {
    schema: 'public',
    table: 'viewings',
    columns: ['contact_id', 'property_id', 'inquiry_id', 'agent_id', 'agency_id', 'scheduled_at', 'status', 'outcome', 'reminders_sent'],
  },
  tasks: {
    schema: 'public',
    table: 'tasks',
    columns: [
      'contact_id', 'inquiry_id', 'opportunity_id', 'viewing_id', 'conversation_id', 'assigned_to',
      'type', 'title', 'notes', 'due_at', 'completed_at', 'status', 'priority', 'created_by',
    ],
  },
  opportunities: {
    schema: 'public',
    table: 'opportunities',
    columns: ['contact_id', 'property_id', 'agent_id', 'agency_id', 'inquiry_id', 'stage', 'deal_value', 'currency', 'probability', 'expected_close_date', 'lost_reason', 'closed_at'],
  },
  opportunity_stage_history: {
    schema: 'public',
    table: 'opportunity_stage_history',
    columns: ['opportunity_id', 'from_stage', 'to_stage', 'changed_by', 'changed_at'],
  },

  // Conversations
  conversations: {
    schema: 'public',
    table: 'conversations',
    columns: ['contact_id', 'contact_email', 'contact_phone', 'contact_name', 'assigned_agent_id', 'source_channel', 'visibility', 'status', 'priority', 'subject', 'last_message_at', 'last_message_preview', 'unread_count', 'is_unread_by_agent'],
  },
  conversation_messages: {
    schema: 'public',
    table: 'conversation_messages',
    columns: ['conversation_id', 'direction', 'channel', 'provider', 'provider_message_id', 'content', 'content_type', 'status', 'sent_at', 'delivered_at', 'read_at', 'failed_reason', 'metadata', 'created_by_agent_id'],
  },

  // Campaigns
  campaigns: { schema: 'public', table: 'campaigns', columns: ['agent_id', 'agency_id', 'name', 'status', 'trigger', 'tags', 'steps'] },
  campaign_enrollments: { schema: 'public', table: 'campaign_enrollments', columns: ['campaign_id', 'contact_id', 'status', 'current_step_index', 'last_sent_at', 'completed_at'] },
  campaign_messages: { schema: 'public', table: 'campaign_messages', columns: ['campaign_id', 'enrollment_id', 'contact_id', 'step_index', 'channel', 'status', 'sent_at', 'content', 'provider_message_id'] },

  // Distribution
  platform_accounts: { schema: 'public', table: 'platform_accounts', columns: ['agent_id', 'agency_id', 'platform', 'account_handle', 'access_token', 'refresh_token', 'expires_at', 'status'] },
  marketplace_connections: { schema: 'public', table: 'marketplace_connections', columns: ['agent_id', 'agency_id', 'platform', 'credentials', 'status'] },
  distributions: { schema: 'public', table: 'distribution_jobs', columns: ['property_id', 'agent_id', 'agency_id', 'platform', 'status', 'payload', 'scheduled_at', 'published_at', 'provider_post_id', 'error_message', 'retry_count'] },
  distribution_jobs: { schema: 'public', table: 'distribution_jobs', columns: ['property_id', 'agent_id', 'agency_id', 'platform', 'status', 'payload', 'scheduled_at', 'published_at', 'provider_post_id', 'error_message', 'retry_count'] },
  distribution_attempts: { schema: 'public', table: 'distribution_attempts', columns: ['distribution_job_id', 'status', 'response', 'error_message', 'attempted_at'] },
  content_submissions: { schema: 'public', table: 'content_submissions', columns: ['property_id', 'agent_id', 'platform', 'status', 'payload', 'submitted_at'] },
  sync_connections: { schema: 'public', table: 'sync_connections', columns: ['agent_id', 'agency_id', 'platform', 'config', 'last_sync_at'] },
  sync_logs: { schema: 'public', table: 'sync_logs', columns: ['sync_connection_id', 'status', 'details'] },

  // Notifications
  consumer_notifications: { schema: 'public', table: 'consumer_notifications', columns: ['user_id', 'agent_id', 'contact_id', 'type', 'title', 'body', 'read', 'metadata'] },
  consumer_notification_prefs: { schema: 'public', table: 'consumer_notification_prefs', columns: ['user_id', 'agent_id', 'channels', 'event_toggles', 'quiet_hours'] },
  consumer_notification_retries: { schema: 'public', table: 'consumer_notification_retries', columns: ['notification_id', 'channel', 'status', 'attempts', 'last_error', 'next_retry_at'] },
  consumer_automation_checkpoints: { schema: 'public', table: 'consumer_automation_checkpoints', columns: ['user_id', 'agent_id', 'checkpoint_type', 'last_evaluated_at', 'cursor'] },

  // Audit / activity
  audit_log: { schema: 'public', table: 'audit_log', columns: ['agent_id', 'agency_id', 'type', 'action', 'entity_type', 'entity_id', 'ip', 'user_agent', 'metadata'] },
  activity_log: { schema: 'public', table: 'activity_log', columns: ['agent_id', 'contact_id', 'property_id', 'inquiry_id', 'opportunity_id', 'viewing_id', 'type', 'meta'] },

  // Templates / entitlements / credits
  message_templates: { schema: 'public', table: 'message_templates', columns: ['owner_type', 'owner_id', 'name', 'channel', 'category', 'subject', 'body', 'variables', 'language', 'approval_status', 'is_default'] },
  feature_entitlements: { schema: 'public', table: 'feature_entitlements', columns: ['scope', 'scope_id', 'feature', 'enabled', 'config'] },
  ai_credit_balances: { schema: 'public', table: 'ai_credit_balances', columns: ['scope', 'scope_id', 'credits_remaining', 'credits_reserved'] },
  ai_credit_transactions: { schema: 'public', table: 'ai_credit_transactions', columns: ['scope', 'scope_id', 'type', 'amount', 'description', 'related_draft_id'] },

  // Auth / support
  auth_recovery_tokens: { schema: 'public', table: 'auth_recovery_tokens', columns: ['user_id', 'email', 'type', 'token_hash', 'status', 'case_id', 'expires_at', 'attempts', 'ip', 'user_agent'] },
  account_recovery_cases: { schema: 'public', table: 'account_recovery_cases', columns: ['user_id', 'email', 'status', 'requested_at', 'reviewed_at', 'reviewed_by', 'ip', 'user_agent'] },
  otp_verifications: { schema: 'public', table: 'otp_verifications', columns: ['user_id', 'channel', 'value_hash', 'code_hash', 'expires_at', 'verified'] },

  // Profile / reviews
  profile_followers: { schema: 'public', table: 'profile_followers', columns: ['follower_id', 'following_id'] },
  profile_views: { schema: 'public', table: 'profile_views', columns: ['viewer_id', 'viewed_id', 'viewed_at'] },
  reviews: { schema: 'public', table: 'reviews', columns: ['agent_id', 'author_id', 'rating', 'comment', 'status'] },
  transactions: { schema: 'public', table: 'transactions', columns: ['agent_id', 'property_id', 'type', 'amount', 'currency', 'status', 'closed_at'] },

  // Templates legacy alias
  templates: { schema: 'public', table: 'message_templates', columns: [] },

  // WhatsApp module (isolated schema)
  whatsapp_listing_sessions: { schema: 'wa_listings', table: 'sessions', columns: ['agent_id', 'agency_id', 'phone_number', 'state', 'intent', 'matched_listing_id', 'messages', 'media', 'location_pins', 'location_source', 'address_description', 'extracted_property', 'selected_variant', 'generated_thumbnails', 'generated_captions', 'draft_id', 'retry_count', 'next_retry_at', 'last_error', 'last_activity_at'] },
  whatsapp_listing_processed_messages: { schema: 'wa_listings', table: 'processed_messages', columns: ['message_id', 'from_number', 'processed_at'] },
  whatsapp_listing_drafts: {
    schema: 'wa_listings',
    table: 'drafts',
    columns: ['session_id', 'agent_id', 'agency_id', 'intent', 'update_of', 'extracted_property', 'change_summary', 'thumbnails', 'captions', 'location_pin_latitude', 'location_pin_longitude', 'location_pin_name', 'location_source', 'address_description', 'status', 'credits_reserved', 'credit_scope', 'credit_scope_id'],
  },
  whatsapp_listing_media: { schema: 'wa_listings', table: 'media', columns: ['session_id', 'draft_id', 'agent_id', 'url', 'mime_type', 'caption', 'file_size'] },
  whatsapp_listing_dead_letters: { schema: 'wa_listings', table: 'dead_letters', columns: ['session_id', 'draft_id', 'stage', 'error_message', 'retry_count', 'payload'] },
  whatsapp_listing_ai_usage_logs: { schema: 'wa_listings', table: 'ai_usage_logs', columns: ['session_id', 'draft_id', 'agent_id', 'provider', 'operation', 'tokens_input', 'tokens_output', 'cost', 'duration_ms'] },
  whatsapp_listing_audit_logs: { schema: 'wa_listings', table: 'audit_logs', columns: ['agent_id', 'agency_id', 'action', 'entity_type', 'entity_id', 'metadata'] },

  // Area Intelligence module (isolated schema)
  area_profiles: {
    schema: 'area_intelligence',
    table: 'area_profiles',
    columns: [
      'name', 'name_ar', 'slug', 'level', 'parent_id', 'center_latitude', 'center_longitude',
      'boundary_geojson', 'proximity_radii_json', 'summary', 'summary_ar', 'lifestyle_profile',
      'investment_outlook', 'activity_score', 'activity_trend', 'family_profile_skew',
      'estimated_population_density', 'status', 'published_at',
    ],
  },
  score_dimensions: {
    schema: 'area_intelligence',
    table: 'score_dimensions',
    columns: [
      'name', 'name_ar', 'description', 'slug', 'display_config', 'scoring_logic_config',
      'composite_weight', 'sort_order', 'is_active', 'is_default',
    ],
  },
  source_types: {
    schema: 'area_intelligence',
    table: 'source_types',
    columns: [
      'name', 'slug', 'description', 'archetype', 'platform', 'input_method',
      'extraction_config', 'default_reliability', 'default_decay_days',
      'default_ai_prompt_template', 'is_active', 'is_default',
    ],
  },
  area_sources: {
    schema: 'area_intelligence',
    table: 'area_sources',
    columns: [
      'area_id', 'source_type_id', 'name', 'handle', 'url', 'api_endpoint', 'feed_url',
      'reliability_override', 'decay_days_override', 'is_monitored', 'last_fetched_at', 'auth_config',
    ],
  },
  area_signals: {
    schema: 'area_intelligence',
    table: 'area_signals',
    columns: [
      'area_id', 'area_source_id', 'source_type_id', 'signal_type', 'raw_content', 'raw_url',
      'raw_media_urls', 'extracted_features', 'occurred_at', 'fetched_at', 'status',
    ],
  },
  area_score_calculations: {
    schema: 'area_intelligence',
    table: 'area_score_calculations',
    columns: [
      'area_id', 'dimension_id', 'calculation_method', 'input_signals', 'input_formula',
      'score_value', 'score_rationale', 'confidence', 'is_manual_override', 'overridden_by',
      'override_reason', 'calculated_at',
    ],
  },
  ai_scoring_configs: {
    schema: 'area_intelligence',
    table: 'ai_scoring_configs',
    columns: [
      'name', 'description', 'provider', 'model', 'temperature', 'max_tokens',
      'system_prompt', 'scoring_prompt_template', 'output_schema', 'is_active',
    ],
  },
  area_google_scores: {
    schema: 'area_intelligence',
    table: 'area_google_scores',
    columns: [
      'area_id', 'source_type_id', 'query_radius_meters', 'query_category', 'results_count',
      'results_json', 'avg_rating', 'total_user_ratings', 'nearest_distance_meters', 'fetched_at',
    ],
  },
  inspector_assignments: {
    schema: 'area_intelligence',
    table: 'inspector_assignments',
    columns: [
      'agent_id', 'area_id', 'assigned_by', 'assigned_at', 'due_at', 'completed_at', 'notes', 'status',
    ],
  },
  inspection_submissions: {
    schema: 'area_intelligence',
    table: 'inspection_submissions',
    columns: [
      'assignment_id', 'agent_id', 'area_id', 'gps_latitude', 'gps_longitude', 'photo_urls',
      'dimension_scores', 'notes', 'status', 'reviewed_by', 'reviewed_at', 'review_notes', 'submitted_at',
    ],
  },
  google_api_usage_log: {
    schema: 'area_intelligence',
    table: 'google_api_usage_log',
    columns: [
      'area_id', 'operation', 'endpoint', 'request_count', 'cost_estimate_usd', 'response_status',
      'error_message',
    ],
  },

  // Market Pricing module (isolated schema)
  pricing_match_configs: {
    schema: 'market_pricing',
    table: 'pricing_match_configs',
    columns: ['name', 'config_json', 'is_default'],
  },
  pricing_sources: {
    schema: 'market_pricing',
    table: 'pricing_sources',
    columns: [
      'source', 'provider', 'label', 'enabled', 'is_internal', 'requires_disclaimer', 'disclaimer',
      'config_json', 'sort_order',
    ],
  },
  pricing_normalization_rules: {
    schema: 'market_pricing',
    table: 'pricing_normalization_rules',
    columns: ['rule_type', 'value', 'adjustment_percent', 'is_active', 'sort_order', 'description'],
  },
  property_price_analyses: {
    schema: 'market_pricing',
    table: 'property_price_analyses',
    columns: [
      'property_id', 'match_config_id', 'comparable_count', 'lowest_price', 'lowest_price_property_id',
      'highest_price', 'highest_price_property_id', 'median_price', 'mean_price', 'percentile_25', 'percentile_75',
      'target_percentile', 'target_vs_median', 'target_vs_median_percent', 'confidence', 'confidence_reason',
      'market_context_sentence', 'currency_normalized', 'parallel_rate_used', 'calculated_at', 'expires_at',
      'lowest_price_comparable_type', 'highest_price_comparable_type', 'target_price', 'analysis_inputs_hash',
      'rate_source', 'rate_effective_at', 'rate_is_stale', 'rate_age_hours',
      'latest_run_id',
    ],
  },
  pricing_analysis_runs: {
    schema: 'market_pricing',
    table: 'analysis_runs',
    columns: ['analysis_id', 'property_id', 'match_config_id', 'analysis_inputs_hash', 'calculated_at', 'result'],
  },
  analysis_comparable_evidence: {
    schema: 'market_pricing',
    table: 'analysis_comparable_evidence',
    columns: [
      'analysis_run_id', 'property_id', 'comparable_type', 'comparable_id', 'source', 'source_label',
      'original_price', 'original_currency', 'normalized_price', 'normalization_rate', 'rate_source',
      'rate_effective_at', 'rate_is_stale', 'similarity_score', 'time_weight', 'weight', 'listed_at', 'area_sqm',
    ],
  },
  pricing_decisions: {
    schema: 'market_pricing',
    table: 'pricing_decisions',
    columns: ['property_id', 'actor_id', 'analysis_id', 'channel', 'action', 'old_price', 'new_price', 'currency', 'reason'],
  },
  external_comparables: {
    schema: 'market_pricing',
    table: 'external_comparables',
    columns: [
      'source', 'source_url', 'external_id', 'title', 'price', 'currency', 'price_normalized_usd',
      'property_type', 'bedrooms', 'bathrooms', 'area_sqm', 'building_age_years', 'condition', 'furnished',
      'view_type', 'payment_method', 'location_text', 'latitude', 'longitude', 'geom', 'area_id',
      'scraped_at', 'last_seen_at', 'status', 'content_hash',
    ],
  },
  price_trend_snapshots: {
    schema: 'market_pricing',
    table: 'price_trend_snapshots',
    columns: [
      'area_id', 'property_type', 'year', 'quarter', 'median_price', 'median_price_per_sqm', 'mean_price',
      'mean_price_per_sqm', 'properties_count', 'new_listings_count', 'change_from_prev_quarter_percent',
      'change_from_prev_year_percent', 'change_24_month_percent', 'trend_direction', 'volatility_percent',
      'confidence', 'confidence_reason',
    ],
  },
  currency_rates: {
    schema: 'market_pricing',
    table: 'currency_rates',
    columns: ['from_currency', 'to_currency', 'rate', 'source', 'source_config', 'effective_at'],
  },
  comparable_reports: {
    schema: 'market_pricing',
    table: 'comparable_reports',
    columns: ['reporter_id', 'comparable_id', 'comparable_type', 'reason', 'notes', 'status', 'reviewed_by', 'reviewed_at'],
  },
  agent_price_reports: {
    schema: 'market_pricing',
    table: 'agent_price_reports',
    columns: [
      'reporter_id', 'agent_id', 'property_id', 'external_property_title', 'external_property_location',
      'property_type', 'bedrooms', 'bathrooms', 'area_sqm', 'sold_price', 'currency',
      'sold_price_normalized_usd', 'sold_date', 'source', 'notes', 'supporting_document_url',
      'status', 'reviewed_by', 'reviewed_at', 'review_notes',
    ],
  },
  csv_import_logs: {
    schema: 'market_pricing',
    table: 'csv_import_logs',
    columns: ['uploaded_by', 'source', 'filename', 'rows_received', 'rows_imported', 'rows_failed', 'errors'],
  },
  pricing_recalculation_jobs: {
    schema: 'market_pricing',
    table: 'recalculation_jobs',
    columns: [
      'requested_by', 'scope_type', 'scope_property_id', 'scope_area_id', 'scope_property_type',
      'force_recompute', 'status', 'total_items', 'processed_items', 'succeeded_items', 'failed_items',
      'attempts', 'max_attempts', 'next_retry_at', 'last_error', 'started_at', 'finished_at',
    ],
  },
  pricing_recalculation_job_items: {
    schema: 'market_pricing',
    table: 'recalculation_job_items',
    columns: [
      'job_id', 'property_id', 'status', 'attempts', 'max_attempts', 'next_retry_at', 'last_error',
      'started_at', 'finished_at',
    ],
  },
}

export function resolveTable(collection) {
  return TABLE_MAP[collection] || { schema: 'public', table: 'legacy_collections', columns: [] }
}

export function isKnownCollection(collection) {
  return Boolean(TABLE_MAP[collection])
}

export function quotedTable(collection) {
  const { schema, table } = resolveTable(collection)
  return `"${schema}"."${table}"`
}

function pick(item, keys) {
  const out = {}
  for (const key of keys) {
    if (key in item) out[key] = item[key]
  }
  return out
}

export function toRow(collection, item) {
  const mapping = resolveTable(collection)
  const typed = pick(item, mapping.columns)
  const row = { ...typed, data: item }
  if (mapping.table === 'legacy_collections') {
    row.collection = collection
  }
  return row
}

export function fromRow(collection, row) {
  const data = row.data ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : {}
  // Typed columns take precedence over data JSON in case of drift.
  const result = { ...data, ...row }
  delete result.data
  return result
}

export function columnNames(collection) {
  const mapping = resolveTable(collection)
  const base = ['id', 'created_at', 'updated_at', 'data', ...mapping.columns]
  if (mapping.table === 'legacy_collections') {
    base.push('collection')
  }
  return base
}
