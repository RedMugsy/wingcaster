/**
 * Default PlatformAdapter.
 *
 * This is the ONLY place the module reaches into the core platform. If the
 * module is extracted to a microservice, only this file needs to change.
 */

import { v4 as uuidv4 } from 'uuid'
import { findOne, findAll, insert, update } from '../../db.js'
import { listUserAgencyMemberships } from '../../tenant-authorization.js'

function serializePropertyForPublish(p) {
  const photos = typeof p.photos === 'string' ? p.photos.split('|') : (p.photos || [])
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    type: p.type,
    property_type: p.property_type,
    price: p.price,
    price_unit: p.price_unit,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    area: p.area,
    area_unit: p.area_unit,
    location: p.location,
    city: p.city,
    neighborhood: p.neighborhood,
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
    location_source: p.location_source,
    address_display: p.address_display,
    amenities: p.amenities,
    furnished: p.furnished,
    photos,
    media: p.media,
    agent_id: p.agent_id,
    agent_name: p.agent_name,
    agent_photo: p.agent_photo,
    agent_license: p.agent_license,
    agency_name: p.agency_name,
    agency_id: p.agency_id,
    reference: p.reference,
    permit_number: p.permit_number,
    asset_version: p.asset_version || 1,
    last_asset_generated_at: p.last_asset_generated_at || null,
  }
}

async function getAgentAgencyId(agentId) {
  const memberships = await listUserAgencyMemberships(agentId)
  const membership = memberships.find((item) => item.affiliation_mode === 'exclusive')
  return membership?.agency_id || null
}

function normalizePropertyForDb(payload, { id, agentId, agencyId, agent, agency, assetVersion = 1 }) {
  const prop = {
    id,
    ...payload,
    canonical_id: id,
    agent_id: agentId,
    agent_name: agent?.name || payload.agent_name || '',
    agent_photo: agent?.photo || '',
    agent_license: agent?.license_number || '',
    agency_name: agency?.name || payload.agency_name || agent?.agency_name || '',
    agency_id: agencyId || payload.agency_id || null,
    agency_tied: Boolean(agencyId),
    listing_owner_type: agencyId ? 'agency' : 'independent',
    marketplace_syndicated: true,
    ungroup_override: false,
    territory_id: payload.territory_id || 'territory-lb',
    classification: payload.classification || payload.property_type || '',
    permissible_buildup_area: payload.permissible_buildup_area || payload.area || null,
    status: payload.status || 'active',
    listed_date: new Date().toISOString().split('T')[0],
    views: 0,
    asset_version: assetVersion,
    last_asset_generated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }

  if (Array.isArray(prop.media)) {
    prop.photos = prop.media.map((m) => m.url).filter(Boolean)
  }
  if (Array.isArray(prop.photos)) prop.photos = prop.photos.join('|')
  if (Array.isArray(prop.amenities)) prop.amenities = prop.amenities.join(',')
  if (prop.latitude != null) prop.latitude = Number(prop.latitude)
  if (prop.longitude != null) prop.longitude = Number(prop.longitude)

  return prop
}

export function createDefaultPlatformAdapter({ pricingContextBuilder } = {}) {
  return {
    async getAgentByWhatsAppNumber(number) {
      const normalized = String(number || '').replace(/\D/g, '')
      return (await findOne('agents', (a) => String(a.phone || '').replace(/\D/g, '') === normalized)) || null
    },

    async getAgentById(agentId) {
      return (await findOne('agents', (a) => a.id === agentId)) || null
    },

    async getAgentSubscriptionFeatures(agentId) {
      const agent = await findOne('agents', (a) => a.id === agentId)
      if (!agent) return null
      const agencyId = await getAgentAgencyId(agentId)
      return { agentId, agencyId, features: agent.subscription_features || null }
    },

    getAgentAgencyId,

    async getAgentListings(agentId, filters = {}) {
      const rows = await findAll('properties', (p) => {
        if (p.agent_id !== agentId) return false
        if (filters.status && p.status !== filters.status) return false
        if (filters.address && !(p.address || '').toLowerCase().includes(String(filters.address).toLowerCase())) return false
        return true
      })
      return rows.map(serializePropertyForPublish)
    },

    async emit(event, payload) {
      // Placeholder: in a microservice this would publish to a message bus.
      return { emitted: true, event, payload }
    },

    async getPricingContext(property) {
      if (!pricingContextBuilder || !property) return ''
      try {
        return await pricingContextBuilder(property)
      } catch (err) {
        // Swallow to avoid breaking the WhatsApp approval flow.
        return ''
      }
    },

    async createListing(payload) {
      const id = uuidv4()
      const agent = await this.getAgentById(payload.agent_id)
      const agencyId = await getAgentAgencyId(payload.agent_id)
      const agency = agencyId ? await findOne('agencies', (a) => a.id === agencyId) : null
      const prop = normalizePropertyForDb(payload, { id, agentId: payload.agent_id, agencyId, agent, agency, assetVersion: 1 })
      await insert('properties', prop)
      return serializePropertyForPublish(await findOne('properties', (p) => p.id === id))
    },

    async updateListing(listingId, payload) {
      const existing = await findOne('properties', (p) => p.id === listingId)
      if (!existing) throw new Error('Listing not found')

      const updates = { ...payload }
      delete updates.id
      delete updates.agent_id
      delete updates.canonical_id

      if (Array.isArray(updates.media)) {
        updates.photos = updates.media.map((m) => m.url).filter(Boolean)
      }
      if (Array.isArray(updates.photos)) updates.photos = updates.photos.join('|')
      if (Array.isArray(updates.amenities)) updates.amenities = updates.amenities.join(',')
      if (updates.latitude != null) updates.latitude = Number(updates.latitude)
      if (updates.longitude != null) updates.longitude = Number(updates.longitude)

      // Only bump asset version if new photos or explicit template change.
      const hasNewPhotos = updates.photos && updates.photos !== existing.photos
      const hasTemplateChange = updates.template_variant && updates.template_variant !== existing.template_variant
      if (hasNewPhotos || hasTemplateChange) {
        updates.asset_version = (existing.asset_version || 1) + 1
        updates.last_asset_generated_at = new Date().toISOString()
      }

      await update('properties', (p) => p.id === listingId, (p) => ({ ...p, ...updates, updated_at: new Date().toISOString() }))
      return serializePropertyForPublish(await findOne('properties', (p) => p.id === listingId))
    },

    async bumpAssetVersion(listingId) {
      const existing = await findOne('properties', (p) => p.id === listingId)
      if (!existing) return null
      await update('properties', (p) => p.id === listingId, (p) => ({
        ...p,
        asset_version: (p.asset_version || 1) + 1,
        last_asset_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }))
      return serializePropertyForPublish(await findOne('properties', (p) => p.id === listingId))
    },

    async publishToInstagram(payload) {
      const distribution = {
        id: uuidv4(),
        property_id: payload.property_id,
        agent_id: payload.agent_id,
        platform: 'instagram',
        owner_type: 'agent',
        status: 'pending_retry',
        formats: payload.formats || ['feed_image'],
        external_id: null,
        meta: {
          delivery: 'whatsapp_listings_module',
          queued: true,
          retry_attempts: 0,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          caption: payload.caption,
          media_urls: payload.media_urls || [],
          thumbnail_urls: payload.thumbnail_urls || {},
          intent: 'whatsapp_listings_publish',
          auto_published: payload.auto_published || false,
          update_badge: payload.update_badge || null,
        },
        views: 0,
        leads: 0,
        clicks: 0,
        cost: 0,
        published_at: null,
        created_at: new Date().toISOString(),
      }
      await insert('distributions', distribution)
      return distribution
    },

    async publishToSocial(payload) {
      const distribution = {
        id: uuidv4(),
        property_id: payload.property_id,
        agent_id: payload.agent_id,
        platform: payload.platform,
        owner_type: 'agent',
        status: 'pending_retry',
        formats: payload.formats || ['post'],
        external_id: null,
        meta: {
          delivery: 'whatsapp_listings_module',
          queued: true,
          retry_attempts: 0,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          caption: payload.caption,
          media_urls: payload.media_urls || [],
          thumbnail_urls: payload.thumbnail_urls || {},
          intent: 'whatsapp_listings_publish',
          auto_published: payload.auto_published || false,
          update_badge: payload.update_badge || null,
        },
        views: 0,
        leads: 0,
        clicks: 0,
        cost: 0,
        published_at: null,
        created_at: new Date().toISOString(),
      }
      await insert('distributions', distribution)
      return distribution
    },

    async logActivity({ type, agent_id, property_id, meta }) {
      await insert('activity_log', {
        id: uuidv4(),
        type,
        agent_id: agent_id || null,
        property_id: property_id || null,
        meta: meta || {},
        created_at: new Date().toISOString(),
      })
    },

    async getPublicApiBase() {
      return process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3001/api'
    },

    async getPublicAppBase() {
      return process.env.PUBLIC_APP_URL || 'http://localhost:7100'
    },
  }
}
