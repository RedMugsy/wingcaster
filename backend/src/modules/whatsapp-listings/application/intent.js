/**
 * Intent classification for WhatsApp listing intake.
 *
 * Detects whether the agent wants to create a new listing or update an
 * existing one. Uses cheap heuristics first, then AI if ambiguous.
 */

import { Intent } from '../domain/types.js'

const UPDATE_KEYWORDS = [
  'update', 'change', 'edit', 'modify', 'price drop', 'price increase', 'reduce price',
  'lower price', 'raise price', 'sold', 'rented', 'pending', 'off market', 'add photos',
  'remove photos', 'update photos', 'change description', 'update listing', 'edit listing',
  'renew', 'relist', 'mark as', 'status', 'availability',
]

const CREATE_KEYWORDS = [
  'new listing', 'list property', 'add property', 'new property', 'for sale', 'for rent',
  'create listing', 'post listing', 'publish listing', 'just listed', 'new apartment',
  'new villa', 'new office', 'rent out', 'sell',
]

export function createIntentClassifier({ aiAdapter }) {
  async function classify({ messages, images, agentListings }) {
    const combinedText = messages
      .filter((m) => typeof m.text === 'string')
      .map((m) => m.text)
      .join(' ')
      .toLowerCase()

    // Explicit keywords first.
    const hasUpdateKeyword = UPDATE_KEYWORDS.some((k) => combinedText.includes(k))
    const hasCreateKeyword = CREATE_KEYWORDS.some((k) => combinedText.includes(k))

    if (hasUpdateKeyword && !hasCreateKeyword) {
      return { intent: Intent.UPDATE, confidence: 0.9, reason: 'update keyword detected', method: 'keyword' }
    }
    if (hasCreateKeyword && !hasUpdateKeyword) {
      return { intent: Intent.CREATE, confidence: 0.9, reason: 'create keyword detected', method: 'keyword' }
    }

    // Check for explicit listing reference (ID or address match).
    const referenceMatch = findReferencedListing(combinedText, agentListings)
    if (referenceMatch && referenceMatch.confidence > 0.8) {
      return {
        intent: Intent.UPDATE,
        confidence: referenceMatch.confidence,
        matched_listing_id: referenceMatch.listing.id,
        matched_address: referenceMatch.listing.address || referenceMatch.listing.location,
        reason: `referenced listing ${referenceMatch.listing.id}`,
        method: 'reference',
      }
    }

    // AI fallback for ambiguous cases.
    if (aiAdapter) {
      try {
        const aiResult = await aiAdapter.classifyIntent({ messages, images })
        if (aiResult?.intent) {
          return {
            intent: aiResult.intent === 'update' ? Intent.UPDATE : Intent.CREATE,
            confidence: aiResult.confidence || 0.7,
            matched_listing_id: aiResult.matched_listing_id || referenceMatch?.listing.id || null,
            matched_address: aiResult.matched_address || referenceMatch?.listing.address || null,
            reason: aiResult.reason || 'ai classification',
            method: 'ai',
          }
        }
      } catch (err) {
        // Fall through to default.
      }
    }

    // Default to create if no strong update signal.
    return { intent: Intent.CREATE, confidence: 0.6, reason: 'no strong update signal', method: 'default' }
  }

  function findReferencedListing(text, listings) {
    if (!listings?.length) return null
    let best = null
    for (const listing of listings) {
      const phrases = [
        listing.id,
        listing.reference,
        listing.permit_number,
        listing.title,
        listing.address,
        listing.location,
      ].filter(Boolean)

      for (const phrase of phrases) {
        if (!phrase) continue
        const normalizedPhrase = String(phrase).toLowerCase().trim()
        if (!normalizedPhrase) continue
        if (text.includes(normalizedPhrase)) {
          const confidence = normalizedPhrase.length > 5 ? 0.9 : 0.7
          if (!best || confidence > best.confidence) {
            best = { listing, confidence }
          }
        }
      }
    }
    return best
  }

  return { classify, findReferencedListing }
}
