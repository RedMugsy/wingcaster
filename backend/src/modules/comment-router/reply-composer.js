/**
 * Reply composer for the process router.
 *
 * Given a template with {placeholders} and a context bundle (contact,
 * listing, distribution), returns a rendered reply string. When an AI
 * adapter is supplied, the composer can ask the model to refine the
 * template into a more natural response (used for Hot auto-replies where
 * template-only text feels canned).
 *
 * Template placeholders:
 *   {contact_name}    — from the incoming author or contact record
 *   {listing_title}   — property.title
 *   {listing_price}   — formatted price with currency
 *   {listing_url}     — external portal URL if any
 *   {agent_name}      — agent identity
 *   {response_time}   — from route config
 *   {price_justification} — best-guess reason (from area comps / view / area)
 */

export function renderTemplate(template, ctx = {}) {
  if (!template) return ''
  const price = formatPrice(ctx.listing?.price, ctx.listing?.price_unit)
  const values = {
    contact_name: ctx.contact?.name || ctx.author_name || 'there',
    listing_title: ctx.listing?.title || 'this property',
    listing_price: price || 'the listed price',
    listing_url: ctx.distribution?.landing_page || ctx.distribution?.post_url || '',
    agent_name: ctx.agent?.name || '',
    response_time: String(ctx.response_time_minutes || 15),
    price_justification: ctx.price_justification || 'of the area, condition, and finish',
  }
  return template.replace(/\{([\w_]+)\}/g, (_, key) => (values[key] != null ? String(values[key]) : `{${key}}`))
}

function formatPrice(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return ''
  const n = Number(value)
  const currency = unit || 'USD'
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${currency} ${(n / 1_000).toFixed(0)}K`
  return `${currency} ${n.toLocaleString()}`
}

/**
 * Refine a template-rendered reply using the AI adapter (optional).
 * Falls back to the raw rendered template if the adapter is missing or
 * the call fails. The prompt is kept short and directive so the model
 * stays close to the template's tone.
 */
export async function refineWithAi({ rendered, category, message, aiAdapter, provider }) {
  if (!aiAdapter || !rendered) return rendered
  const prompt = `You are a professional real-estate agent writing a short public reply on a social-media comment.

The public comment was:
"""
${(message?.content || '').slice(0, 500)}
"""

The comment was categorised as: ${category}.

Rewrite the reply below to sound natural, warm, and specific — keep it under
280 characters, single paragraph, no hashtags, no marketing fluff. Preserve
every fact and named entity. Do NOT invent details.

Template reply:
"""
${rendered}
"""

Return only the rewritten reply as plain text, no quotes, no preface.`

  try {
    let text
    if (typeof aiAdapter.classifyText === 'function') {
      // Reuse the classifier hook if the adapter exposes it as a generic text call.
      text = await aiAdapter.classifyText({ prompt, provider })
    } else if (typeof aiAdapter.generateMarketContextSentence === 'function') {
      const r = await aiAdapter.generateMarketContextSentence({ prompt, provider })
      text = r?.sentence || r
    } else {
      return rendered
    }
    const cleaned = String(text || '').trim().replace(/^["']|["']$/g, '')
    if (cleaned.length < 10) return rendered
    return cleaned.slice(0, 500)
  } catch {
    return rendered
  }
}
