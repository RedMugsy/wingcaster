/**
 * Shared domain constants for the WhatsApp Listing module.
 */

export const WHATSAPP_LISTINGS_FEATURE = 'whatsapp_listings'

export const DraftStatus = {
  INTAKE: 'intake',
  EXTRACTING: 'extracting',
  AWAITING_APPROVAL: 'awaiting_approval',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  DISCARDED: 'discarded',
  ERROR: 'error',
}

export const SessionState = {
  IDLE: 'idle',
  COLLECTING: 'collecting',
  READY_FOR_EXTRACTION: 'ready_for_extraction',
  EXTRACTING: 'extracting',
  AWAITING_APPROVAL: 'awaiting_approval',
  AWAITING_PRICE_ADJUSTMENT: 'awaiting_price_adjustment',
  PUBLISHING: 'publishing',
  COMPLETED: 'completed',
  ERROR: 'error',
}

export const MessageDirection = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
}

export const MessageType = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  VOICE: 'voice',
  DOCUMENT: 'document',
  INTERACTIVE: 'interactive',
  UNKNOWN: 'unknown',
}

export const TemplateVariant = {
  LUXE: 'luxe',
  MODERN: 'modern',
  URGENT: 'urgent',
}

export const SocialPlatform = {
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  X: 'x',
  TELEGRAM: 'telegram',
}

export const EntitlementScope = {
  PLATFORM: 'platform',
  AGENCY: 'agency',
  AGENT: 'agent',
}

export const CreditType = {
  TOP_UP: 'top_up',
  CONSUMPTION: 'consumption',
  REFUND: 'refund',
  ADJUSTMENT: 'adjustment',
}

export const CreditScope = {
  AGENT: 'agent',
  AGENCY: 'agency',
}

export const Intent = {
  CREATE: 'create',
  UPDATE: 'update',
}

export const LocationSource = {
  WHATSAPP_PIN: 'whatsapp_pin',
  MANUAL_MAP_SELECTION: 'manual_map_selection',
  AGENT_TEXT: 'agent_text',
  UNKNOWN: 'unknown',
}

export function defaultEntitlementConfig() {
  return {
    enabled: true,
    max_drafts_per_month: 50,
    ai_providers_allowed: ['gemini', 'openai'],
    thumbnail_variants: ['luxe', 'modern', 'urgent'],
    auto_publish_social: false,
  }
}
