import { loadDb, insert, getDb, update, findOne, findAll } from './db.js'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { ensureUniqueAgentSlug, getActiveAffiliation } from './platformModel.js'
import { defaultEntitlementConfig } from './modules/whatsapp-listings/domain/types.js'
import { buildDefaultNotificationPrefs, ensureDefaultNotificationPreferences } from './notification-preferences.js'
import { createAgentAccount } from './identity.js'

async function ensureSeedAdmin(email) {
  if (!email) return null
  const normalizedEmail = email.trim().toLowerCase()
  const existing = await findOne('users', (user) => user.email === normalizedEmail)
  const verifiedAt = existing?.verified_at || new Date().toISOString()
  if (existing) {
    await update('users', (user) => user.id === existing.id, (user) => ({
      ...user,
      role: 'agent',
      platform_role: 'platform_admin',
      verified: true,
      verified_at: verifiedAt,
    }))
    await update('agents', (agent) => agent.user_id === existing.id, (agent) => ({
      ...agent,
      verified: true,
      platform_role: 'platform_admin',
    }))
    return existing.id
  }

  const id = uuidv4()
  const createdAt = new Date().toISOString()
  await createAgentAccount({
    user: {
      id,
      email: normalizedEmail,
      name: 'Platform Administrator',
      role: 'agent',
      platform_role: 'platform_admin',
      verified: true,
      verified_at: verifiedAt,
      token_version: 0,
      created_at: createdAt,
      updated_at: createdAt,
    },
    agent: {
      id,
      user_id: id,
      email: normalizedEmail,
      name: 'Platform Administrator',
      role: 'agent',
      platform_role: 'platform_admin',
      verified: true,
      slug: `platform-admin-${id.slice(0, 8)}`,
      created_at: createdAt,
      updated_at: createdAt,
    },
  })
  return id
}

export async function ensureSeedAdmins() {
  const emails = new Set([process.env.ADMIN_EMAIL, process.env.SMOKE_ADMIN_EMAIL].filter(Boolean))
  for (const email of emails) await ensureSeedAdmin(email)
}

export async function ensureMigrations() {
  await loadDb()

  const feature_entitlements = await findAll('feature_entitlements')
  const message_templates = await findAll('message_templates')
  const agents = await findAll('agents')
  const territories = await findAll('territories')
  const territory_disclosure_fields = await findAll('territory_disclosure_fields')
  const agencies = await findAll('agencies')
  const white_label_sites = await findAll('white_label_sites')
  const properties = await findAll('properties')
  const canonical_properties = await findAll('canonical_properties')
  const consumer_notification_prefs = await findAll('consumer_notification_prefs')
  const inquiries = await findAll('inquiries')
  const tasks = await findAll('tasks')
  const platform_accounts = await findAll('platform_accounts')

  // Ensure default WhatsApp Listings platform entitlement exists.
  if (!(feature_entitlements || []).some((e) => e.scope === 'platform' && e.feature === 'whatsapp_listings')) {
    await insert('feature_entitlements', {
      id: uuidv4(),
      scope: 'platform',
      scope_id: 'platform',
      feature: 'whatsapp_listings',
      enabled: process.env.NODE_ENV !== 'production',
      config: defaultEntitlementConfig(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  // Seed platform default message templates if none exist.
  const defaultTemplates = [
    {
      id: uuidv4(),
      name: 'Welcome new lead',
      channel: 'whatsapp',
      category: 'greeting',
      subject: null,
      body: 'Hi {{client_name}}, thank you for reaching out. I\'m {{agent_name}} and I\'d be happy to help you find the right property. What are you looking for?',
      variables: ['client_name', 'agent_name'],
      language: 'en',
      approval_status: 'approved',
      owner_type: 'platform',
      owner_id: null,
      is_default: true,
      usage_count: 0,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      name: 'Welcome SMS',
      channel: 'sms',
      category: 'greeting',
      subject: null,
      body: 'Hi {{client_name}}, this is {{agent_name}}. Thanks for your inquiry. I\'ll get back to you shortly.',
      variables: ['client_name', 'agent_name'],
      language: 'en',
      approval_status: 'approved',
      owner_type: 'platform',
      owner_id: null,
      is_default: true,
      usage_count: 0,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      name: 'Viewing confirmation',
      channel: 'email',
      category: 'viewing',
      subject: 'Viewing confirmed for {{property_title}}',
      body: 'Hi {{client_name}},\n\nYour viewing for {{property_title}} is confirmed for {{viewing_date}}.\n\nBest,\n{{agent_name}}',
      variables: ['client_name', 'agent_name', 'property_title', 'viewing_date'],
      language: 'en',
      approval_status: 'approved',
      owner_type: 'platform',
      owner_id: null,
      is_default: true,
      usage_count: 0,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      name: 'Follow-up after viewing',
      channel: 'email',
      category: 'follow_up',
      subject: 'Following up on {{property_title}}',
      body: 'Hi {{client_name}},\n\nI hope the viewing of {{property_title}} went well. Do you have any questions or would you like to make an offer?\n\nBest,\n{{agent_name}}',
      variables: ['client_name', 'agent_name', 'property_title'],
      language: 'en',
      approval_status: 'approved',
      owner_type: 'platform',
      owner_id: null,
      is_default: true,
      usage_count: 0,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      name: 'Price drop notification',
      channel: 'whatsapp',
      category: 'offer',
      subject: null,
      body: 'Hi {{client_name}}, great news — the price for {{property_title}} has dropped to {{price}}. Let me know if you\'d like to schedule a viewing.',
      variables: ['client_name', 'property_title', 'price'],
      language: 'en',
      approval_status: 'approved',
      owner_type: 'platform',
      owner_id: null,
      is_default: true,
      usage_count: 0,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]

  if (!(message_templates || []).some((t) => t.owner_type === 'platform' && t.is_default)) {
    for (const tpl of defaultTemplates) {
      await insert('message_templates', tpl)
    }
  }

  // Agent is a professional persona, never a platform authorization role.
  for (const a of agents || []) {
    const patch = {}
    if (a.role !== 'agent') patch.role = 'agent'
    if (!a.slug) patch.slug = await ensureUniqueAgentSlug(a.name || a.email?.split('@')[0] || a.id, a.id)
    if (Object.keys(patch).length) {
      await update('agents', (x) => x.id === a.id, (x) => ({ ...x, ...patch }))
    }
  }

  await ensureSeedAdmins()

  // Territory disclosure config (Decision 2) — Lebanon launch baseline
  if (!(territories || []).some((t) => t.id === 'territory-lb')) {
    await insert('territories', {
      id: 'territory-lb',
      code: 'LB',
      name: 'Lebanon',
      status: 'active',
      created_at: new Date().toISOString(),
    })
  }
  const lbFields = [
    { id: 'lb-classification', territory_id: 'territory-lb', key: 'classification', label: 'Classification', field_type: 'text', required: true, sort_order: 1 },
    { id: 'lb-buildup', territory_id: 'territory-lb', key: 'permissible_buildup_area', label: 'Permissible Buildup Area', field_type: 'number', required: true, unit: 'sqm', sort_order: 2 },
  ]
  for (const f of lbFields) {
    if (!(territory_disclosure_fields || []).some((x) => x.id === f.id)) await insert('territory_disclosure_fields', f)
  }

  // Agency hosting mode (Decision 4)
  for (const a of agencies || []) {
    if (!a.site_hosting_type) {
      const hasSite = (white_label_sites || []).some((s) => s.agency_id === a.id)
      await update('agencies', (x) => x.id === a.id, (x) => ({
        ...x,
        site_hosting_type: hasSite ? 'whitelabel' : 'none',
      }))
    }
  }

  // Property Part B fields (Decisions 1, 3, 4)
  for (const p of properties || []) {
    const patch = {}
    if (!p.canonical_id) patch.canonical_id = p.id
    if (p.marketplace_syndicated === undefined) patch.marketplace_syndicated = true
    if (p.ungroup_override === undefined) patch.ungroup_override = false
    if (p.agency_tied === undefined) {
      const aff = await getActiveAffiliation(p.agent_id)
      if (aff) {
        patch.agency_tied = true
        patch.agency_id = aff.agency_id
        patch.listing_owner_type = 'agency'
      } else {
        patch.agency_tied = false
        patch.agency_id = null
        patch.listing_owner_type = 'independent'
      }
    }
    if (!p.territory_id) patch.territory_id = 'territory-lb'
    if (p.classification === undefined) patch.classification = p.property_type || ''
    if (p.permissible_buildup_area === undefined) patch.permissible_buildup_area = p.area || null
    if (p.status === undefined) patch.status = 'active'
    if (p.asset_version === undefined) patch.asset_version = 1
    if (p.last_asset_generated_at === undefined) patch.last_asset_generated_at = null
    if (Object.keys(patch).length) {
      await update('properties', (x) => x.id === p.id, (x) => ({ ...x, ...patch }))
    }

    // Mirror into canonical_properties when missing
    if (!(canonical_properties || []).some((c) => c.id === (patch.canonical_id || p.canonical_id || p.id))) {
      const cid = patch.canonical_id || p.canonical_id || p.id
      await insert('canonical_properties', {
        id: cid,
        primary_listing_id: p.id,
        location: p.location,
        city: p.city,
        neighborhood: p.neighborhood,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        property_type: p.property_type,
        ungroup_override: p.ungroup_override || false,
        created_at: new Date().toISOString(),
      })
    }
  }

  // Notification preferences default-on migration
  await ensureDefaultNotificationPreferences({
    agents,
    preferences: consumer_notification_prefs,
    createId: uuidv4,
    insertPreference: (prefs) => insert('consumer_notification_prefs', prefs),
  })

  // Task-first migration: backfill tasks from legacy inquiry next_follow_up_at values.
  const inquiriesWithFollowUp = (inquiries || []).filter((i) => i.next_follow_up_at && !['closed_won', 'closed_lost'].includes(i.status || ''))
  for (const inq of inquiriesWithFollowUp) {
    const hasTask = (tasks || []).some((t) => t.inquiry_id === inq.id)
    if (hasTask) continue
    const now = new Date().toISOString()
    await insert('tasks', {
      id: uuidv4(),
      contact_id: inq.contact_id || null,
      inquiry_id: inq.id,
      opportunity_id: null,
      conversation_id: null,
      assigned_to: inq.assigned_to || inq.agent_id || null,
      type: 'follow_up',
      title: `Follow up on ${inq.property_title || 'inquiry'}`,
      notes: 'Migrated from inquiry next_follow_up_at',
      due_at: inq.next_follow_up_at,
      completed_at: new Date(inq.next_follow_up_at).getTime() < Date.now() ? now : null,
      status: new Date(inq.next_follow_up_at).getTime() < Date.now() ? 'completed' : 'pending',
      priority: inq.priority === 'urgent' || inq.priority === 'high' ? inq.priority : 'normal',
      created_by: inq.agent_id || null,
      created_at: now,
      updated_at: now,
    })
  }

  // Platform accounts used by the distribution hub UI
  const fiAccounts = [
    { id: 'fi-wa', type: 'fi', platform: 'whatsapp', account_name: 'REB WhatsApp', description: 'Official catalogue & chat', status: 'active' },
    { id: 'fi-ig', type: 'fi', platform: 'instagram', account_name: '@realestatebazaar', description: 'Official Instagram', status: 'active' },
    { id: 'fi-tg', type: 'fi', platform: 'telegram', account_name: 'REB Channel', description: 'Official Telegram', status: 'active' },
    { id: 'fi-tt', type: 'fi', platform: 'tiktok', account_name: '@realestatebazaar', description: 'Official TikTok', status: 'active' },
    { id: 'fi-x', type: 'fi', platform: 'x', account_name: '@realestatebazaar', description: 'Official X', status: 'active' },
  ]
  for (const acc of fiAccounts) {
    if (!(await findOne('platform_accounts', (a) => a.id === acc.id))) await insert('platform_accounts', acc)
  }
}

export async function seedData() {
  await loadDb()
  await ensureMigrations()
  // Demo-data seeding removed in Phase 7b.1c/16 per the "no MVPs, no
  // demos" bar. If a developer needs sample content locally they can
  // register normally through the API.
  return
}
