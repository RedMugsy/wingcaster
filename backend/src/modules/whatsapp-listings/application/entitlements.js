/**
 * Entitlement service for the WhatsApp Listing module.
 *
 * Hierarchy (most specific wins):
 *   1. agent entitlement for the agent
 *   2. agency entitlement for the agent's agency
 *   3. platform default entitlement
 *
 * If none exist, the module uses a generous default in development and a
 * disabled default in production.
 */

import {
  WHATSAPP_LISTINGS_FEATURE,
  EntitlementScope,
  defaultEntitlementConfig,
} from '../domain/types.js'
import { Collections, findOneModule, findAllModule, insertModule, updateModule, removeModule } from '../infrastructure/db.js'
import { v4 as uuidv4 } from 'uuid'

const isProduction = process.env.NODE_ENV === 'production'

export function createEntitlementService({ adapter }) {
  async function ensureDefaultEntitlement() {
    const existing = await findOneModule(Collections.FEATURE_ENTITLEMENTS, (e) =>
      e.scope === EntitlementScope.PLATFORM && e.feature === WHATSAPP_LISTINGS_FEATURE,
    )
    if (existing) return existing

    const config = defaultEntitlementConfig()
    if (isProduction) config.enabled = false

    return await insertModule(Collections.FEATURE_ENTITLEMENTS, {
      id: uuidv4(),
      scope: EntitlementScope.PLATFORM,
      scope_id: 'platform',
      feature: WHATSAPP_LISTINGS_FEATURE,
      enabled: config.enabled,
      config,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  async function resolveEntitlement({ agentId, agencyId }) {
    await ensureDefaultEntitlement()

    const all = await findAllModule(Collections.FEATURE_ENTITLEMENTS, (e) => e.feature === WHATSAPP_LISTINGS_FEATURE)

    const agentEntitlement = agentId
      ? all.find((e) => e.scope === EntitlementScope.AGENT && e.scope_id === agentId)
      : null
    const agencyEntitlement = agencyId
      ? all.find((e) => e.scope === EntitlementScope.AGENCY && e.scope_id === agencyId)
      : null
    const platformEntitlement = all.find((e) => e.scope === EntitlementScope.PLATFORM)

    const source = agentEntitlement || agencyEntitlement || platformEntitlement
    if (!source) return null

    return {
      ...source,
      config: {
        ...defaultEntitlementConfig(),
        ...(source.config || {}),
      },
    }
  }

  async function isEnabled({ agentId, agencyId }) {
    const entitlement = await resolveEntitlement({ agentId, agencyId })
    if (!entitlement) return false
    return entitlement.enabled === true
  }

  async function getConfig({ agentId, agencyId }) {
    return (await resolveEntitlement({ agentId, agencyId }))?.config || defaultEntitlementConfig()
  }

  async function checkMonthlyQuota({ agentId }) {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const drafts = await findAllModule(Collections.DRAFTS, (d) =>
      d.agent_id === agentId &&
      d.status !== 'discarded' &&
      d.created_at >= startOfMonth,
    )
    const count = drafts.length
    const entitlement = await resolveEntitlement({ agentId })
    const max = entitlement?.config?.max_drafts_per_month ?? defaultEntitlementConfig().max_drafts_per_month
    return { allowed: count < max, used: count, max }
  }

  async function createEntitlement(payload) {
    const config = { ...defaultEntitlementConfig(), ...(payload.config || {}) }
    return await insertModule(Collections.FEATURE_ENTITLEMENTS, {
      id: uuidv4(),
      scope: payload.scope,
      scope_id: payload.scope_id,
      feature: payload.feature || WHATSAPP_LISTINGS_FEATURE,
      enabled: payload.enabled === undefined ? true : Boolean(payload.enabled),
      config,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  async function updateEntitlement(id, payload) {
    const existing = await findOneModule(Collections.FEATURE_ENTITLEMENTS, (e) => e.id === id)
    if (!existing) return null

    const config = payload.config ? { ...defaultEntitlementConfig(), ...(existing.config || {}), ...payload.config } : existing.config
    return await updateModule(
      Collections.FEATURE_ENTITLEMENTS,
      (e) => e.id === id,
      (e) => ({
        ...e,
        ...(payload.scope !== undefined && { scope: payload.scope }),
        ...(payload.scope_id !== undefined && { scope_id: payload.scope_id }),
        ...(payload.feature !== undefined && { feature: payload.feature }),
        ...(payload.enabled !== undefined && { enabled: Boolean(payload.enabled) }),
        ...(payload.config !== undefined && { config }),
        updated_at: new Date().toISOString(),
      }),
    )
  }

  async function deleteEntitlement(id) {
    return await removeModule(Collections.FEATURE_ENTITLEMENTS, (e) => e.id === id)
  }


  async function listEntitlements({ scope, scope_id, feature = WHATSAPP_LISTINGS_FEATURE } = {}) {
    return await findAllModule(Collections.FEATURE_ENTITLEMENTS, (e) => {
      if (feature && e.feature !== feature) return false
      if (scope && e.scope !== scope) return false
      if (scope_id && e.scope_id !== scope_id) return false
      return true
    })
  }

  return {
    resolveEntitlement,
    isEnabled,
    getConfig,
    checkMonthlyQuota,
    createEntitlement,
    updateEntitlement,
    deleteEntitlement,
    listEntitlements,
    ensureDefaultEntitlement,
  }
}
