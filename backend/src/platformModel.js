/**
 * Part B platform model helpers (Decisions 1–4).
 * Agent-owned accounts, exclusive affiliation, canonical listings, syndication flags.
 */

import { findAll, findOne, update, insert } from './db.js'
import {
  endAgencyMembership,
  getAgencyMembership,
  listUserAgencyMemberships,
  normalizeAgencyMembershipInput,
} from './tenant-authorization.js'

export function slugify(name) {
  return String(name || 'agent')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'agent'
}

export async function ensureUniqueAgentSlug(base, excludeId) {
  let slug = slugify(base)
  let n = 0
  while (await findOne('agents', (a) => a.slug === slug && a.id !== excludeId)) {
    n += 1
    slug = `${slugify(base)}-${n}`
  }
  return slug
}

export async function getActiveAffiliation(userId) {
  const memberships = await listUserAgencyMemberships(userId)
  const membership = memberships.find((item) => item.affiliation_mode === 'exclusive')
  if (!membership) return null
  return {
    ...membership,
    id: membership.legacy_agency_member_id || membership.id,
    tenant_membership_id: membership.id,
  }
}

export async function getActiveAgencyForUser(userId) {
  const membership = await getActiveAffiliation(userId)
  if (!membership) return null
  return (await findOne('agencies', (a) => a.id === membership.agency_id)) || null
}

/** Enforce explicit affiliation semantics and one active exclusive affiliation. */
export async function assertCanJoinAgency(userId, agencyId, { role, affiliationMode } = {}) {
  let normalized
  try {
    normalized = normalizeAgencyMembershipInput({ role, affiliationMode })
  } catch (err) {
    return { ok: false, error: err.message }
  }
  const memberships = await listUserAgencyMemberships(userId)
  const sameAgency = memberships.find((membership) => membership.agency_id === agencyId)
  if (sameAgency) {
    return { ok: false, error: 'Already a member of this agency' }
  }
  const existing = memberships.find((membership) => membership.affiliation_mode === 'exclusive')
  if (normalized.affiliationMode === 'exclusive' && existing) {
    return {
      ok: false,
      error: 'Agent already has an exclusive active agency affiliation. End that affiliation before joining another.',
    }
  }
  return { ok: true, ...normalized }
}

export async function endAffiliation(memberId, agencyId, { endedBy, reason } = {}) {
  const member = await findOne('agency_members', (m) => m.id === memberId && m.agency_id === agencyId)
  if (!member) return { ok: false, error: 'Membership not found' }
  if (member.status !== 'active') return { ok: false, error: 'Membership is not active' }

  const tiedListings = await findAll(
    'properties',
    (p) =>
      p.agent_id === member.user_id &&
      (p.agency_tied === true || p.agency_tied === 1) &&
      p.agency_id === agencyId &&
      p.status !== 'reassigned' &&
      p.status !== 'withdrawn',
  )

  if (tiedListings.length > 0) {
    return {
      ok: false,
      error: 'Reassign agency-tied listings before ending affiliation',
      requires_reassignment: true,
      listings: tiedListings.map((p) => ({
        id: p.id,
        title: p.title,
        canonical_id: p.canonical_id || p.id,
        status: p.status || 'active',
      })),
    }
  }

  const canonical = await getAgencyMembership(agencyId, member.user_id)
  if (!canonical) return { ok: false, error: 'Canonical tenant membership not found' }
  try {
    const result = await endAgencyMembership({
      agencyId,
      membershipId: canonical.id,
      endedBy,
      reason,
    })
    return { ...result, member_id: memberId }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function reassignAgencyTiedListing(propertyId, { fromAgentId, toAgentId, agencyId, actorId }) {
  const prop = await findOne('properties', (p) => p.id === propertyId)
  if (!prop) return { ok: false, error: 'Listing not found' }
  if (prop.agent_id !== fromAgentId) return { ok: false, error: 'Listing is not owned by departing agent' }
  if (!(prop.agency_tied === true || prop.agency_tied === 1)) {
    return { ok: false, error: 'Listing is not agency-tied' }
  }
  if (prop.agency_id && prop.agency_id !== agencyId) {
    return { ok: false, error: 'Listing belongs to a different agency affiliation' }
  }

  const toAgent = await findOne('agents', (a) => a.id === toAgentId)
  if (!toAgent) return { ok: false, error: 'Target agent not found' }
  const toAff = await getActiveAffiliation(toAgentId)
  if (!toAff || toAff.agency_id !== agencyId) {
    return { ok: false, error: 'Target agent must be an active member of the same agency' }
  }

  await update(
    'properties',
    (p) => p.id === propertyId,
    (p) => ({
      ...p,
      agent_id: toAgentId,
      agent_name: toAgent.name,
      agent_photo: toAgent.photo,
      agent_license: toAgent.license_number,
      agency_tied: true,
      agency_id: agencyId,
      tenant_id: `agency:${agencyId}`,
      custody_tenant_id: `agency:${agencyId}`,
      ownership_type: 'agency',
      reassigned_from: fromAgentId,
      reassigned_at: new Date().toISOString(),
      reassigned_by: actorId,
    }),
  )

  await insert('activity_log', {
    id: `reassign-${propertyId}-${Date.now()}`,
    type: 'listing_reassigned',
    property_id: propertyId,
    agent_id: toAgentId,
    meta: { from_agent_id: fromAgentId, agency_id: agencyId, actor_id: actorId },
    created_at: new Date().toISOString(),
  })

  return { ok: true }
}

export async function resolveListingAffiliation({ agentId, agencyTiedRequested }) {
  const agency = await getActiveAgencyForUser(agentId)
  const wantTied = agencyTiedRequested !== false && agencyTiedRequested !== 0 && agencyTiedRequested !== 'false'
  if (wantTied && agency) {
    return {
      agency_tied: true,
      agency_id: agency.id,
      agency_name: agency.name,
      listing_owner_type: 'agency',
    }
  }
  return {
    agency_tied: false,
    agency_id: null,
    agency_name: agency?.name || '',
    listing_owner_type: 'independent',
  }
}

export function isMarketplaceVisible(property) {
  if (property.marketplace_syndicated === false || property.marketplace_syndicated === 0) return false
  const status = property.status || 'active'
  if (['sold', 'rented', 'withdrawn', 'expired', 'draft', 'hold', 'unpublished'].includes(status)) return false
  return true
}

export function isAgencySiteVisible(property, agencyId) {
  if (!agencyId) return false
  const status = property.status || 'active'
  if (['sold', 'rented', 'withdrawn', 'expired', 'draft', 'hold', 'unpublished'].includes(status)) return false
  if (property.agency_id === agencyId) return true
  if ((property.agency_tied === true || property.agency_tied === 1) && property.agency_id === agencyId) return true
  return false
}

export function parseDeviceFromUa(ua = '') {
  const s = String(ua || '')
  if (/iPad|Tablet|Kindle/i.test(s)) return 'Tablet'
  if (/Mobile|Android|iPhone|iPod|webOS|BlackBerry|IEMobile/i.test(s)) return 'Mobile'
  return 'Desktop'
}

const LB_GEO = [
  { city: 'Beirut', country: 'Lebanon', region: 'Beirut' },
  { city: 'Tripoli', country: 'Lebanon', region: 'North' },
  { city: 'Jounieh', country: 'Lebanon', region: 'Mount Lebanon' },
  { city: 'Sidon', country: 'Lebanon', region: 'South' },
  { city: 'Zahle', country: 'Lebanon', region: 'Bekaa' },
  { city: 'Byblos', country: 'Lebanon', region: 'Mount Lebanon' },
  { city: 'Tyre', country: 'Lebanon', region: 'South' },
  { city: 'Baabda', country: 'Lebanon', region: 'Mount Lebanon' },
]

function hashStr(s) {
  let h = 0
  for (let i = 0; i < String(s).length; i++) h = ((h << 5) - h) + String(s).charCodeAt(i)
  return Math.abs(h)
}

export function inferGeoFromRequest(req, fallbackKey = '') {
  const cityHint = req?.headers?.['x-geo-city'] || req?.query?.city
  if (cityHint) {
    return { city: String(cityHint), country: 'Lebanon', region: String(cityHint) }
  }
  return LB_GEO[hashStr(fallbackKey || req?.ip || 'lb') % LB_GEO.length]
}

export async function recordProfileView({
  entityType,
  entityId,
  channel = 'web_profile',
  device = null,
  geo_city = null,
  geo_country = null,
  geo_region = null,
  referrer = null,
}) {
  await insert('profile_views', {
    id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    entity_type: entityType,
    entity_id: entityId,
    channel,
    device: device || 'Desktop',
    geo_city: geo_city || 'Beirut',
    geo_country: geo_country || 'Lebanon',
    geo_region: geo_region || 'Beirut',
    referrer: referrer || 'direct',
    created_at: new Date().toISOString(),
  })
}

/** Ensure property has enough event samples for analytics charts (demo-friendly). */
export async function ensureListingEventSamples(property) {
  if (!property?.id) return
  const existing = await findAll('listing_events', (e) => e.property_id === property.id)
  const target = Math.max(property.views || 0, existing.length)
  if (existing.length >= Math.min(target, 40) && existing.length > 0) return

  const need = Math.min(Math.max(target, 8), 60) - existing.length
  if (need <= 0) return

  const channels = ['marketplace', 'whatsapp', 'instagram', 'direct', 'google', 'agency_site']
  const devices = ['Desktop', 'Mobile', 'Tablet']
  const types = ['view', 'view', 'view', 'click', 'click']
  for (let i = 0; i < need; i++) {
    const h = hashStr(`${property.id}-${existing.length + i}`)
    const geo = LB_GEO[h % LB_GEO.length]
    const daysAgo = h % 28
    const created = new Date(Date.now() - daysAgo * 86400000 - (h % 86400000))
    await insert('listing_events', {
      id: `evt-${property.id.slice(0, 8)}-${existing.length + i}-${h}`,
      property_id: property.id,
      type: types[h % types.length],
      channel: channels[h % channels.length],
      device: devices[h % devices.length],
      geo_city: geo.city,
      geo_country: geo.country,
      geo_region: geo.region,
      referrer: channels[h % channels.length] === 'google' ? 'google.com' : 'direct',
      created_at: created.toISOString(),
    })
  }
}

export function aggregateListingEvents(events) {
  const byDevice = {}
  const byGeo = {}
  const byChannel = {}
  const byReferrer = {}
  let views = 0
  let clicks = 0
  events.forEach((e) => {
    if (e.type === 'click') clicks += 1
    else views += 1
    byDevice[e.device || 'Unknown'] = (byDevice[e.device || 'Unknown'] || 0) + 1
    const geoKey = e.geo_city || 'Unknown'
    byGeo[geoKey] = (byGeo[geoKey] || 0) + 1
    byChannel[e.channel || 'unknown'] = (byChannel[e.channel || 'unknown'] || 0) + 1
    byReferrer[e.referrer || 'direct'] = (byReferrer[e.referrer || 'direct'] || 0) + 1
  })
  const toSorted = (obj) =>
    Object.entries(obj)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)

  return {
    views,
    clicks,
    by_device: toSorted(byDevice),
    by_geography: toSorted(byGeo),
    by_channel: toSorted(byChannel),
    by_referrer: toSorted(byReferrer),
  }
}

export async function getEngagementSummary(entityType, entityId) {
  const views = await findAll('profile_views', (v) => v.entity_type === entityType && v.entity_id === entityId)
  const followers = await findAll('profile_followers', (f) => f.entity_type === entityType && f.entity_id === entityId && f.status !== 'unfollowed')
  const byChannel = {}
  views.forEach((v) => {
    const ch = v.channel || 'unknown'
    byChannel[ch] = (byChannel[ch] || 0) + 1
  })
  return {
    views_total: views.length,
    followers_total: followers.length,
    by_channel: byChannel,
    // Decision 1 open item: detailed breakdown is agent-only until PA confirms agency visibility
    visibility: 'agent_only',
  }
}

export async function followEntity({ followerId, entityType, entityId }) {
  const existing = await findOne(
    'profile_followers',
    (f) => f.follower_id === followerId && f.entity_type === entityType && f.entity_id === entityId,
  )
  if (existing) {
    await update('profile_followers', (f) => f.id === existing.id, (f) => ({
      ...f,
      status: 'active',
      followed_at: new Date().toISOString(),
    }))
    return { ok: true, following: true }
  }
  await insert('profile_followers', {
    id: `fol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    follower_id: followerId,
    entity_type: entityType,
    entity_id: entityId,
    status: 'active',
    followed_at: new Date().toISOString(),
  })
  return { ok: true, following: true }
}

export async function unfollowEntity({ followerId, entityType, entityId }) {
  await update(
    'profile_followers',
    (f) => f.follower_id === followerId && f.entity_type === entityType && f.entity_id === entityId,
    (f) => ({ ...f, status: 'unfollowed', unfollowed_at: new Date().toISOString() }),
  )
  return { ok: true, following: false }
}

export async function isFollowing({ followerId, entityType, entityId }) {
  const row = await findOne(
    'profile_followers',
    (f) =>
      f.follower_id === followerId &&
      f.entity_type === entityType &&
      f.entity_id === entityId &&
      f.status !== 'unfollowed',
  )
  return Boolean(row)
}
