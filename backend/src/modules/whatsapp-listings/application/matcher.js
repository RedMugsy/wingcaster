/**
 * Listing matcher service.
 *
 * Ranks the agent's existing listings against incoming content (text, address,
 * detected location) to find the best candidate for an update intent.
 */

export function createListingMatcher({ adapter }) {
  async function findMatches({ agentId, text, detectedAddress, detectedLocation, detectedCoordinates, photoCount = 0, minConfidence = 0.5 }) {
    const listings = await adapter.getAgentListings(agentId, { status: 'active' })
    if (!listings.length) return []

    const query = String(text || '').toLowerCase()
    const queryAddress = String(detectedAddress || '').toLowerCase()
    const queryLocation = String(detectedLocation || '').toLowerCase()

    const scored = listings.map((listing) => {
      let score = 0
      let reasons = []

      const title = String(listing.title || '').toLowerCase()
      const address = String(listing.address || '').toLowerCase()
      const location = String(listing.location || '').toLowerCase()
      const neighborhood = String(listing.neighborhood || '').toLowerCase()
      const city = String(listing.city || '').toLowerCase()
      const reference = String(listing.reference || '').toLowerCase()
      const permitNumber = String(listing.permit_number || '').toLowerCase()

      if (reference && query.includes(reference)) {
        score += 1.0
        reasons.push('reference match')
      }
      if (permitNumber && query.includes(permitNumber)) {
        score += 1.0
        reasons.push('permit number match')
      }
      if (address && queryAddress && (address.includes(queryAddress) || queryAddress.includes(address))) {
        score += 0.9
        reasons.push('address match')
      }
      if (location && queryLocation && (location.includes(queryLocation) || queryLocation.includes(location))) {
        score += 0.8
        reasons.push('location match')
      }
      if (neighborhood && query.includes(neighborhood)) {
        score += 0.6
        reasons.push('neighborhood mention')
      }
      if (city && query.includes(city)) {
        score += 0.5
        reasons.push('city mention')
      }
      if (title && query.includes(title)) {
        score += 0.5
        reasons.push('title mention')
      }

      // Implicit match: GPS coordinate proximity.
      if (detectedCoordinates && typeof detectedCoordinates.latitude === 'number' && typeof detectedCoordinates.longitude === 'number') {
        const listingLat = Number(listing.latitude)
        const listingLng = Number(listing.longitude)
        if (!Number.isNaN(listingLat) && !Number.isNaN(listingLng)) {
          const distanceKm = haversineDistance(detectedCoordinates.latitude, detectedCoordinates.longitude, listingLat, listingLng)
          if (distanceKm < 0.1) {
            score += 0.85
            reasons.push(`exact coordinate match (${distanceKm.toFixed(3)} km)`)
          } else if (distanceKm < 1.0) {
            score += 0.75
            reasons.push(`very close coordinate match (${distanceKm.toFixed(2)} km)`)
          } else if (distanceKm < 5.0) {
            score += 0.55
            reasons.push(`nearby coordinate match (${distanceKm.toFixed(1)} km)`)
          }
        }
      }

      // Implicit match: photos provided strongly suggest a real visit/update for this listing.
      if (photoCount > 0) {
        const hasLocationSignal = reasons.some((r) => r.includes('match') || r.includes('coordinate'))
        if (hasLocationSignal) {
          score += 0.1
          reasons.push('photos + location signal')
        }
      }

      // Property type / bedroom overlap adds weak signal.
      if (listing.property_type && query.includes(String(listing.property_type).toLowerCase())) {
        score += 0.1
        reasons.push('property type mention')
      }

      return {
        listing,
        score: Math.min(1, score),
        confidence: Math.min(1, score),
        reasons,
      }
    })

    const matches = scored
      .filter((m) => m.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)

    return matches
  }

  async function findBestMatch(context) {
    const matches = await findMatches(context)
    return matches[0] || null
  }

  return { findMatches, findBestMatch }
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371 // Earth radius in km
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg) {
  return (deg * Math.PI) / 180
}
