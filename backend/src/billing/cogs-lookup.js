/**
 * COGS reference data — verified external costs as of August 2026.
 *
 * SPEC §7. Re-verify quarterly. Every value here has `[COGS]` provenance.
 * Store as data, keyed for lookup. Never hard-code these into event
 * emitters — always resolve through the rate card so a rate change on
 * 1 Oct 2026 (Meta) or the next X policy shift can land in a config
 * edit, not a deploy.
 */

// WhatsApp per-message cost by country. From 1 October 2026, Meta charges
// for utility templates + free-form service messages inside the 24h window.
// Category: utility_service = both utility templates AND service messages
// (unified after Oct 2026); marketing = marketing template category.
export const WHATSAPP_COST_BY_COUNTRY = {
  AE: { utility_service: 0.0157, marketing: 0.0499 },
  SA: { utility_service: 0.0107, marketing: 0.0501 },
  EG: { utility_service: 0.0036, marketing: 0.0644 },
  LB: { utility_service: 0.0091, marketing: 0.0341 },
  GB: { utility_service: 0.0220, marketing: 0.0529 },
  AU: { utility_service: 0.0113, marketing: 0.0732 },
  US: { utility_service: 0.0034, marketing: 0.0250 },
  // Fallback for countries not explicitly listed — mid-range values.
  DEFAULT: { utility_service: 0.015, marketing: 0.050 },
}

// SMS per-message cost by country. Priced at cost + 40% to tenant.
// Arabic SMS uses UCS-2 (70 chars/segment) — a full-length message is
// usually 2-3 segments; multiply cost accordingly at emission time.
export const SMS_COST_BY_COUNTRY = {
  EG: 0.3959,
  LB: 0.3619,
  SA: 0.1949,
  AE: 0.1176,
  GB: 0.0560,
  AU: 0.0515,
  US: 0.0083,
  DEFAULT: 0.10,
}

export const SMS_MARKUP_PCT = 40 // spec §14 [SEED]

// Publishing COGS (rendering + API costs).
export const PUBLISH_COGS = {
  'publish.meta.facebook':  { cost_low: 0.005, cost_high: 0.005 },
  'publish.meta.instagram': { cost_low: 0.005, cost_high: 0.005 },
  'publish.linkedin':       { cost_low: 0.005, cost_high: 0.005 },
  'publish.tiktok':         { cost_low: 0.005, cost_high: 0.005 },
  'publish.portal.api':     { cost_low: 0.006, cost_high: 0.006 },
  'publish.rpa':            { cost_low: 0.010, cost_high: 0.050 },
  'publish.x.plain':        { cost_low: 0.015, cost_high: 0.015 },
  'publish.x.link':         { cost_low: 0.200, cost_high: 0.200 },
  'render.template.standard': { cost_low: 0.002, cost_high: 0.002 },
  'render.template.premium':  { cost_low: 0.015, cost_high: 0.015 },
}

// AI generation COGS.
export const AI_COGS = {
  'ai.description.generated': { cost_low: 0.008, cost_high: 0.012 },
  'ai.classification':        { cost_low: 0.00019, cost_high: 0.000375 },
  'ai.reply.drafted':         { cost_low: 0.0005, cost_high: 0.0005 },
  'ai.chat.turn':             { cost_low: 0.001, cost_high: 0.001 },
}

// Data enrichment COGS (property scores, AVMs, staging images).
export const DATA_COGS = {
  'score.property.cached': { cost_low: 0.002, cost_high: 0.002 },
  'score.property.fresh':  { cost_low: 0.21, cost_high: 0.38 },
  'avm.report':            { cost_low: 0.65, cost_high: 1.00 },
  'staging.ai_image':      { cost_low: 0.24, cost_high: 0.32 },
}

// Rate 0 actions — always emitted, never charged. Cost still tracked
// for internal blended-cost math (§7 reference figures).
export const STATE_COGS = {
  'listing.created':          { cost_low: 0, cost_high: 0 },
  'listing.published_first':  { cost_low: 0, cost_high: 0 },
  'listing.active_day':       { cost_low: 0.000024, cost_high: 0.000024 }, // storage
  'storage.gb_day':           { cost_low: 0.015 / 30, cost_high: 0.015 / 30 }, // Cloudflare R2
  'seat.active_day':          { cost_low: 0, cost_high: 0 },
  'support.ticket_opened':    { cost_low: 8, cost_high: 25 }, // 20 min human time avg
  'webhook.received':         { cost_low: 0, cost_high: 0 },
  'message.in.whatsapp':      { cost_low: 0, cost_high: 0 },
  'message.in.meta_dm':       { cost_low: 0, cost_high: 0 },
  'message.in.x_dm':          { cost_low: 0, cost_high: 0 },
  'message.in.comment':       { cost_low: 0, cost_high: 0 },
  'message.in.portal_lead':   { cost_low: 0, cost_high: 0 },
  'message.out.meta_dm':      { cost_low: 0, cost_high: 0 },
  'message.out.email':        { cost_low: 0.0001, cost_high: 0.00016 },
}

/**
 * Resolve COGS estimate for an emitted event. Uses the mid-point of the
 * cost band when a range is given. Returns cost in USD (float).
 *
 * For WhatsApp / SMS the country is required and dispatched separately
 * because the cost is a country-parametric table, not a per-action fixed.
 */
export function estimateCogsUsd({ actionKey, quantity = 1, country, whatsappCategory }) {
  const q = Math.max(1, Number(quantity) || 1)

  if (actionKey === 'message.out.whatsapp.utility'
    || actionKey === 'message.out.whatsapp.marketing') {
    const cat = whatsappCategory
      || (actionKey === 'message.out.whatsapp.marketing' ? 'marketing' : 'utility_service')
    const bookedCountry = country || 'DEFAULT'
    const table = WHATSAPP_COST_BY_COUNTRY[bookedCountry] || WHATSAPP_COST_BY_COUNTRY.DEFAULT
    return q * (table[cat] || 0)
  }

  if (actionKey === 'message.out.sms') {
    const bookedCountry = country || 'DEFAULT'
    const base = SMS_COST_BY_COUNTRY[bookedCountry] || SMS_COST_BY_COUNTRY.DEFAULT
    return q * base
  }

  const tables = [PUBLISH_COGS, AI_COGS, DATA_COGS, STATE_COGS]
  for (const t of tables) {
    if (t[actionKey]) {
      const low = t[actionKey].cost_low
      const high = t[actionKey].cost_high
      return q * ((low + high) / 2)
    }
  }
  return 0 // unknown action — assume free (safe default; picked up in telemetry)
}
