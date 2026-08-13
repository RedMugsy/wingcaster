/**
 * Comment classifier for inbound social engagement (Instagram / Facebook /
 * TikTok / X / LinkedIn comments and mentions).
 *
 * Two-stage pipeline:
 *   1. classifyByRules(text) — fast, deterministic, no external calls.
 *      Covers the obvious ~60-70% of cases (reactions, questions with
 *      price/availability keywords, spam patterns, referrals, buy intent).
 *   2. classifyBatchByAi(items, aiAdapter) — reclassifies ambiguous rows
 *      (category = 'general' with low confidence). Uses the existing
 *      multi-provider AI adapter (Claude / OpenAI / Gemini / Kimi with
 *      fallback + circuit breaker).
 *
 * Both stages return the same shape:
 *   { category, sentiment, confidence, source, matched_rule?, reasoning? }
 *
 * The classification is stored on the conversation_messages row and is
 * queryable via GET /api/listings/:id/comments?category=hot_lead,interest.
 */

export const COMMENT_CATEGORIES = /** @type {const} */ ([
  'hot_lead',    // explicit buy / rent / close intent
  'interest',    // asking price, availability, viewing — pre-buy signal
  'investor',    // investment-focused: yield, ROI, rental income, cap rate
  'question',    // neutral inquiry, not obviously commercial
  'objection',   // property-specific negative (too expensive, too small)
  'complaint',   // service or seller negative (scam, unresponsive)
  'testimonial', // past client positive feedback
  'reaction',    // emoji-only or one-word positive
  'referral',    // tags / mentions another person
  'spam',        // promotional junk, obvious bots
  'general',     // catch-all
])

export const COMMENT_SENTIMENTS = /** @type {const} */ (['positive', 'neutral', 'negative'])

export const CATEGORY_META = {
  hot_lead:    { label: 'Hot lead',    emoji: '🔥', description: 'Explicit buy or rent intent.',                                   route: 'ai_auto_response_and_crm_hot'    },
  interest:    { label: 'Interest',    emoji: '💬', description: 'Asks about price, availability, or viewing.',                    route: 'crm_lead_qualification'          },
  investor:    { label: 'Investor',    emoji: '📈', description: 'Investment-focused: yield, ROI, rental income, cap rate.',        route: 'crm_investor_pipeline'           },
  question:    { label: 'Question',    emoji: '❓', description: 'Neutral question, not obviously commercial.',                    route: 'inquiries_inbox_with_listing'    },
  objection:   { label: 'Objection',   emoji: '⚠️', description: 'Property-specific negative — recoverable with agent handling.',   route: 'agent_escalation_with_suggestion'},
  complaint:   { label: 'Complaint',   emoji: '🚨', description: 'Negative about service or seller. Priority escalation.',          route: 'priority_escalation_agent_owner' },
  testimonial: { label: 'Testimonial', emoji: '🏆', description: 'Past client positive feedback.',                                  route: 'marketing_social_proof_queue'    },
  reaction:    { label: 'Reaction',    emoji: '👍', description: 'Emoji-only or brief positive reaction.',                          route: 'engagement_metrics_only'         },
  referral:    { label: 'Referral',    emoji: '🔗', description: 'Tags or mentions another person.',                                route: 'notify_agent_dm_tagged'          },
  spam:        { label: 'Spam',        emoji: '🚫', description: 'Promotional junk or bot. Filtered from all views.',               route: 'auto_filter_hidden'              },
  general:     { label: 'General',     emoji: '💭', description: 'Small talk or unclear intent. AI watches the thread.',            route: 'ai_thread_consumer'              },
}

/* ----------------------------- Rules stage ----------------------------- */

// Extracted from a scan of common real-estate MENA + global social engagement
// samples. Deliberately conservative — anything that doesn't match a rule
// with confidence >= 0.75 falls to 'general' so the AI stage can revisit.

const RE_MENTION           = /(?:^|\s)@[\w\.]{2,}/
const RE_PRICE_TOKEN       = /(\$|USD|AED|SAR|EGP|LBP|EUR|GBP|£|€)\s*[\d,]+|\b\d{2,3}k\b/i
const RE_PRICE_WORD        = /\b(price|how much|cost|rate|monthly|yearly|per month|per year|installments?|down payment|payment plan)\b/i
const RE_AVAILABILITY      = /\b(available|still available|status|on the market|open house|for sale|for rent|to let|à louer|à vendre)\b/i
const RE_VIEWING           = /\b(visit|viewing|see it|come see|showing|tour|appointment|schedule|book a viewing|come by)\b/i
const RE_CONTACT_INTENT    = /\b(dm me|call me|reach me|whatsapp|contact me|send.*details|message me|inbox|شارك التفاصيل)\b/i
const RE_HOT_INTENT        = /\b(i want to buy|i'?ll take (it|this)|i'?m buying|purchase this|make an offer|ready to buy|i want this|بشتري|أريد شراء|بدي اشتري)\b/i
const RE_QUESTION_STARTER  = /^(what|where|when|how|why|is this|is it|can|could|does|do|are|will|which|who|whose)\b/i
const RE_QUESTION_MARK     = /\?\s*$/
const RE_SPAM              = /\b(buy (\d+k?\s+)?followers?|free followers?|crypto (invest(ors?|ing|ments?)?|trad(er|ing|ers)|signals?)|bitcoin (invest(ors?|ing|ments?)?|trad(er|ing|ers))|nft (drop|mint|whitelist)|onlyfans|only\s?fans|click (this )?link|link in bio.*(promo|earn|money)|forex (signals?|trad(er|ing))|10x your money|dm for (promo|business|opportunity)|dm (me )?for (crypto|forex|signals?|investment))\b/i
const RE_SPAM_URL          = /https?:\/\/(bit\.ly|t\.co|tinyurl|goo\.gl|shorturl)\/\S+/i
const RE_EMOJI_ONLY        = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}‍️]+$/u
const RE_REACTION_WORDS    = /^(wow|nice|cool|beautiful|gorgeous|stunning|amazing|love it|love this|dream|😍|❤️|🔥|great|perfect|incredible|awesome|best)\W*$/i

// Investor language — yield, ROI, rental income, cap rate. Distinct from
// end-user "interest" because it feeds a different qualification path.
const RE_INVESTOR          = /\b(cap rate|cap-rate|rental yield|gross yield|net yield|rental income|cash flow|cashflow|roi|return on investment|noi|net operating income|occupancy rate|investment (property|opportunity|potential)|rental potential|(short|long)[- ]?term rental|airbnb potential|hold period|cap ex|payback (period|time))\b/i

// Complaint — service or seller negative. Priority escalation, never
// auto-respond. Matches BEFORE objection so scam-tier claims aren't
// downgraded to a recoverable objection.
const RE_COMPLAINT         = /\b(scam|fake listing|misleading (photos?|ad)|false advertising|deceiv(ed|ing)|bait and switch|never (responded|got back|replied|answered)|still waiting for (your |a )?(reply|response|answer)|poor service|unprofessional|(really |so |very )?disappointed with (this |the |your )?(agent|agency|service)|worst (experience|service|agent)|shady|dishonest|misled|liar|liars|stole (my|our) (deposit|money)|refund my (deposit|money))\b/i

// Objection — property-specific negative. Recoverable — agent handles.
// Do NOT auto-respond (bad look). Matches AFTER complaint so service-level
// grievances aren't misclassified as property gripes.
const RE_OBJECTION         = /\b(too expensive|way too (much|expensive|pricey)|overpriced|not worth (it|the (price|money|ask))|why so (expensive|pricey|high|much)|(too |very |so )?(small|tiny|cramped) (for the price|kitchen|bathroom|living room|bedroom|for that price)|no (parking|elevator|balcony|view|garden)|(missing|lacking) (parking|elevator|amenities?|storage)|(the |this )?(kitchen|bathroom|floor|ceiling|building|neighborhood|neighbourhood|area) (is|looks) (too )?(small|old|dated|dirty|noisy|cramped|bad|awful|worn|ugly)|far from (everything|the metro|transport)|no natural light)\b/i

// Testimonial — past client positive feedback. Feeds a social-proof
// marketing queue with consent workflow.
const RE_TESTIMONIAL       = /\b((bought|purchased|rented|sold|got) (my|our|his|her|their) (place|home|house|property|apartment|villa|flat|studio|penthouse) (through|with|via|from) (them|him|her|this (agent|agency)|you|the agent)|(highly |strongly )?recommend (this |the )?(agent|agency)|(best|great|amazing|wonderful) (agent|realtor|broker) (i|we)('ve| have) (worked|dealt) with|amazing (agent|service|experience)|(my|our) experience with (this |the |your )?(agent|agency|team) was (great|amazing|wonderful|excellent|fantastic)|(couldn't|could not) (be )?happier with)\b/i

const POSITIVE_TOKENS = ['love', 'beautiful', 'gorgeous', 'stunning', 'wow', 'amazing', 'perfect', 'dream', 'incredible', 'best', 'awesome', 'excellent', 'fantastic', 'lovely', 'nice', '❤️', '😍', '🔥', '👌', '💯']
const NEGATIVE_TOKENS = ['overpriced', 'terrible', 'hate', 'awful', 'ugly', 'disappointing', 'scam', 'fake', 'trash', 'garbage', 'ripoff', 'rip-off', 'junk', 'crap', 'worst']

function detectSentiment(text) {
  const lower = String(text || '').toLowerCase()
  let pos = 0, neg = 0
  for (const t of POSITIVE_TOKENS) if (lower.includes(t)) pos++
  for (const t of NEGATIVE_TOKENS) if (lower.includes(t)) neg++
  if (neg > pos) return 'negative'
  if (pos > neg) return 'positive'
  return 'neutral'
}

/**
 * Rule-based classification. Returns { category, sentiment, confidence,
 * source: 'rules', matched_rule }.
 *
 * Order matters — higher-signal rules match first. Confidence reflects how
 * uniquely the text fits the category (spam patterns are very high; a bare
 * question mark is lower). Anything under 0.6 confidence is left as
 * 'general' so the AI stage can revisit.
 */
export function classifyByRules(text) {
  const raw = String(text || '').trim()
  if (!raw) {
    return { category: 'general', sentiment: 'neutral', confidence: 0, source: 'rules', matched_rule: 'empty' }
  }

  const sentiment = detectSentiment(raw)

  // Spam first — high-signal, don't want it polluting other buckets.
  if (RE_SPAM.test(raw) || RE_SPAM_URL.test(raw)) {
    return { category: 'spam', sentiment: 'neutral', confidence: 0.92, source: 'rules', matched_rule: 'spam_pattern' }
  }

  // Complaint (service/seller-level negative) — MUST match before objection
  // so "scam" / "unresponsive" / "false ad" don't get downgraded to a
  // recoverable objection.
  if (RE_COMPLAINT.test(raw)) {
    return { category: 'complaint', sentiment: 'negative', confidence: 0.88, source: 'rules', matched_rule: 'complaint_pattern' }
  }

  // Testimonial (past client positive) — matches before hot_lead / interest
  // because past-tense "bought my place through" would otherwise look like
  // buy intent from a current lead.
  if (RE_TESTIMONIAL.test(raw)) {
    return { category: 'testimonial', sentiment: 'positive', confidence: 0.85, source: 'rules', matched_rule: 'testimonial_pattern' }
  }

  // Objection (property-specific negative) — recoverable. Matches AFTER
  // complaint so service grievances aren't misclassified as property gripes.
  if (RE_OBJECTION.test(raw)) {
    return { category: 'objection', sentiment: 'negative', confidence: 0.82, source: 'rules', matched_rule: 'objection_pattern' }
  }

  // Investor — investment vocabulary. Matches before generic hot/interest
  // because "ROI" / "cap rate" is a distinct qualification path.
  if (RE_INVESTOR.test(raw)) {
    return { category: 'investor', sentiment, confidence: 0.88, source: 'rules', matched_rule: 'investor_vocabulary' }
  }

  // Hot lead — explicit buy intent phrases.
  if (RE_HOT_INTENT.test(raw)) {
    return { category: 'hot_lead', sentiment, confidence: 0.9, source: 'rules', matched_rule: 'buy_intent' }
  }

  // Interest — price / availability / viewing / contact intent.
  if (RE_PRICE_TOKEN.test(raw) || RE_PRICE_WORD.test(raw)) {
    return { category: 'interest', sentiment, confidence: 0.85, source: 'rules', matched_rule: 'price_signal' }
  }
  if (RE_AVAILABILITY.test(raw)) {
    return { category: 'interest', sentiment, confidence: 0.82, source: 'rules', matched_rule: 'availability_signal' }
  }
  if (RE_VIEWING.test(raw)) {
    return { category: 'interest', sentiment, confidence: 0.82, source: 'rules', matched_rule: 'viewing_signal' }
  }
  if (RE_CONTACT_INTENT.test(raw)) {
    return { category: 'interest', sentiment, confidence: 0.78, source: 'rules', matched_rule: 'contact_intent' }
  }

  // Referral — @mention that isn't the agent's own handle. We can't check
  // the agent's own handle from here, so any @mention triggers referral;
  // false positives are cheap.
  if (RE_MENTION.test(raw)) {
    return { category: 'referral', sentiment, confidence: 0.7, source: 'rules', matched_rule: 'mention' }
  }

  // Reaction — emoji-only or single-word positive.
  if (RE_EMOJI_ONLY.test(raw) || RE_REACTION_WORDS.test(raw) || raw.length <= 4) {
    return { category: 'reaction', sentiment: sentiment === 'neutral' ? 'positive' : sentiment, confidence: 0.85, source: 'rules', matched_rule: 'reaction_pattern' }
  }

  // Question — question mark or wh-word starter, but no commerce signal.
  if (RE_QUESTION_MARK.test(raw) || RE_QUESTION_STARTER.test(raw)) {
    return { category: 'question', sentiment, confidence: 0.68, source: 'rules', matched_rule: 'question_pattern' }
  }

  // Fallback — low confidence so the AI stage revisits.
  return { category: 'general', sentiment, confidence: 0.3, source: 'rules', matched_rule: 'no_rule_matched' }
}

/**
 * Whether the AI stage should reclassify this row. True when the rules
 * stage was uncertain (low confidence) or landed in the general bucket.
 */
export function shouldRunAiFallback(classification) {
  if (!classification) return true
  if (classification.source === 'manual') return false
  if (classification.category === 'general') return true
  if (typeof classification.confidence === 'number' && classification.confidence < 0.6) return true
  return false
}

/* ------------------------------ AI stage ------------------------------- */

const AI_PROMPT = `You classify short social-media comments left on a real-estate listing.

For each item you receive, choose exactly ONE category and ONE sentiment.

Categories:
- hot_lead:    explicit buy or rent intent ("I want to buy", "I'll take it", "how do I purchase")
- interest:    asking price, availability, viewing, or how to contact (pre-buy signal, end-user)
- investor:    investment-focused — yield, cap rate, ROI, rental income, cash flow, occupancy
- question:    neutral inquiry not obviously commercial (location, building age, amenities)
- objection:   property-specific negative — recoverable ("too expensive", "kitchen is small", "no parking")
- complaint:   service or seller negative ("scam", "never responded", "misleading photos") — priority
- testimonial: past client positive feedback ("bought my house through them, amazing")
- reaction:    emoji-only or one-word positive, no engagement to chase
- referral:    tags or mentions another person to look at the listing
- spam:        promotional junk, crypto shilling, follower-buying, obvious bots
- general:     everything else — small talk, unclear intent

Sentiments: positive | neutral | negative.

Distinguish complaint (service/seller grievance — never recoverable in-thread) from
objection (property gripe — recoverable with agent handling). "Scam" or "never got
back to me" is complaint. "Too expensive" or "kitchen is too small" is objection.

Return strict JSON in this exact shape (no markdown, no explanation outside
the JSON):
{
  "items": [
    { "id": "<the id you were given>", "category": "...", "sentiment": "...", "confidence": 0.0-1.0, "reasoning": "one short phrase" }
  ]
}`

export function buildAiClassificationPrompt(items) {
  const lines = items.map((it, i) => `  ${i + 1}. id="${it.id}"  text=${JSON.stringify(it.text)}`)
  return `${AI_PROMPT}\n\nItems to classify:\n${lines.join('\n')}`
}

/**
 * Classify a batch of comments via the provided AI adapter. The adapter is
 * expected to expose a `generateCaption`-style JSON generation entrypoint or
 * an explicit `classify` method — we look for either shape and adapt.
 *
 * Returns an array aligned with `items`, each { id, category, sentiment,
 * confidence, source: 'ai', reasoning }.
 */
export async function classifyBatchByAi({ items, aiAdapter, provider }) {
  if (!items?.length) return []
  if (!aiAdapter) throw new Error('aiAdapter is required for AI classification')

  const prompt = buildAiClassificationPrompt(items)

  // Prefer a purpose-built method if the adapter exposes one; fall back to
  // the market-context sentence generator (same underlying providers) which
  // returns free-form text we can then parse. This keeps the classifier
  // decoupled from any single adapter shape.
  let raw
  if (typeof aiAdapter.classifyText === 'function') {
    raw = await aiAdapter.classifyText({ prompt, provider })
  } else if (typeof aiAdapter.generateMarketContextSentence === 'function') {
    const result = await aiAdapter.generateMarketContextSentence({ prompt, provider })
    raw = result?.sentence || JSON.stringify(result || '')
  } else {
    throw new Error('AI adapter does not expose classifyText or generateMarketContextSentence')
  }

  let parsed
  try {
    const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    parsed = JSON.parse(cleaned)
  } catch {
    // If the model returns anything non-JSON, leave every item as general/neutral
    // low-confidence — the rules stage already ran, so this is a soft failure.
    return items.map((it) => ({
      id: it.id, category: 'general', sentiment: 'neutral',
      confidence: 0.4, source: 'ai', reasoning: 'ai_response_unparseable',
    }))
  }

  const byId = new Map()
  for (const row of parsed?.items || []) {
    byId.set(String(row.id), row)
  }
  return items.map((it) => {
    const row = byId.get(String(it.id))
    if (!row) {
      return { id: it.id, category: 'general', sentiment: 'neutral', confidence: 0.4, source: 'ai', reasoning: 'no_ai_row' }
    }
    const category = COMMENT_CATEGORIES.includes(row.category) ? row.category : 'general'
    const sentiment = COMMENT_SENTIMENTS.includes(row.sentiment) ? row.sentiment : 'neutral'
    const confidence = Math.max(0, Math.min(1, Number(row.confidence) || 0.5))
    return {
      id: it.id,
      category,
      sentiment,
      confidence,
      source: 'ai',
      reasoning: String(row.reasoning || '').slice(0, 200),
    }
  })
}
