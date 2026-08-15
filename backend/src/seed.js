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

  const shouldSeedDemo =
    process.env.SEED_DEMO_DATA === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_DATA !== 'false')

  if (!shouldSeedDemo) return

  const agents = await findAll('agents')
  if (agents.length > 0) return

  const passwordHash = bcrypt.hashSync('password123', 10)

  const seedAgents = [
    { id: 'agent-1', name: 'Karim Haddad', email: 'karim@realestatebazaar.com', phone: '+961 3 123 456', password_hash: passwordHash, license_number: 'RL-28471', agency_name: 'Haddad Premium Properties', agency_license: 'AL-8892', photo: 'https://i.pravatar.cc/150?u=agent1', specialization: 'Luxury Residential', experience_since: 2015, languages: 'English, Arabic, French', rating: 4.9, review_count: 127, response_time: 'Usually responds within 15 minutes', bio: 'With over 9 years of experience in Lebanon\'s luxury property market, Karim has closed over 400 transactions.', verified: 1, role: 'agent' },
    { id: 'agent-2', name: 'Nadine Rahme', email: 'nadine@realestatebazaar.com', phone: '+961 3 987 654', password_hash: passwordHash, license_number: 'RL-31592', agency_name: 'Rahme Real Estate', agency_license: 'AL-4451', photo: 'https://i.pravatar.cc/150?u=agent2', specialization: 'Commercial & Investment', experience_since: 2018, languages: 'English, Arabic', rating: 4.7, review_count: 89, response_time: 'Usually responds within 30 minutes', bio: 'Nadine focuses on commercial properties and investment opportunities across Lebanon.', verified: 1, role: 'agent' },
    { id: 'agent-3', name: 'Marc Khoury', email: 'marc@realestatebazaar.com', phone: '+961 3 555 888', password_hash: passwordHash, license_number: 'RL-19283', agency_name: 'Khoury Property Group', agency_license: 'AL-7723', photo: 'https://i.pravatar.cc/150?u=agent3', specialization: 'New Developments', experience_since: 2012, languages: 'English, Arabic, French, German', rating: 4.8, review_count: 203, response_time: 'Usually responds within 10 minutes', bio: 'One of Lebanon\'s top agents for new developments and off-plan projects.', verified: 1, role: 'agent' },
  ]
  for (const a of seedAgents) {
    const { password_hash, ...profile } = a
    const createdAt = new Date().toISOString()
    await createAgentAccount({
      user: {
        id: a.id,
        email: a.email,
        phone: a.phone,
        name: a.name,
        password_hash,
        role: 'agent',
        token_version: 0,
        created_at: createdAt,
        updated_at: createdAt,
      },
      agent: {
        ...profile,
        user_id: a.id,
        role: 'agent',
        created_at: createdAt,
        updated_at: createdAt,
      },
    })
    await insert(
      'consumer_notification_prefs',
      buildDefaultNotificationPrefs(a.id, { id: uuidv4() }),
    )
  }

  const seedProperties = [
    { id: 'prop-1', title: 'Luxury 3-Bedroom Apartment in Achrafieh', description: 'Stunning apartment in the heart of Achrafieh with panoramic city views.', type: 'sale', property_type: 'apartment', price: 850000, bedrooms: 3, bathrooms: 3, area: 180, area_unit: 'sqm', location: 'Achrafieh, Beirut', city: 'Beirut', neighborhood: 'Achrafieh', address: 'Sassine Street, Achrafieh', latitude: 33.8886, longitude: 35.5163, amenities: 'Security,Covered Parking,Shared Gym,Shared Pool,Central A/C,Balcony,Built in Wardrobes,Concierge', furnished: 0, photos: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800|https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800', agent_id: 'agent-1', agent_name: 'Karim Haddad', agent_photo: 'https://i.pravatar.cc/150?u=agent1', agent_license: 'RL-28471', agency_name: 'Haddad Premium Properties', listed_date: '2024-03-01', permit_number: 'LP-2024-08921', reference: 'REB-ACH-3BR-001', featured: 1, views: 1247 },
    { id: 'prop-2', title: 'Penthouse with Sea View in Downtown', description: 'Exclusive penthouse overlooking the Mediterranean.', type: 'sale', property_type: 'penthouse', price: 2800000, bedrooms: 4, bathrooms: 5, area: 320, area_unit: 'sqm', location: 'Downtown Beirut', city: 'Beirut', neighborhood: 'Downtown', address: 'Foch Street, Downtown Beirut', latitude: 33.8969, longitude: 35.5024, amenities: 'Security,Private Pool,Private Gym,Central A/C,Balcony,Built in Wardrobes,Smart Home,Private Elevator', furnished: 0, photos: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800|https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800', agent_id: 'agent-1', agent_name: 'Karim Haddad', agent_photo: 'https://i.pravatar.cc/150?u=agent1', agent_license: 'RL-28471', agency_name: 'Haddad Premium Properties', listed_date: '2024-02-15', permit_number: 'LP-2024-07654', reference: 'REB-DT-PH-002', featured: 1, views: 2893 },
    { id: 'prop-3', title: 'Modern Townhouse in Saifi Village', description: 'Contemporary townhouse in Beirut\'s most artistic district.', type: 'sale', property_type: 'townhouse', price: 1200000, bedrooms: 4, bathrooms: 4, area: 280, area_unit: 'sqm', location: 'Saifi Village, Beirut', city: 'Beirut', neighborhood: 'Saifi Village', address: 'Georges Haddad Street, Saifi Village', latitude: 33.8934, longitude: 35.5072, amenities: 'Security,Covered Parking,Private Garden,Central A/C,Balcony,Built in Wardrobes,Storage Room', furnished: 0, photos: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800|https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=800', agent_id: 'agent-1', agent_name: 'Karim Haddad', agent_photo: 'https://i.pravatar.cc/150?u=agent1', agent_license: 'RL-28471', agency_name: 'Haddad Premium Properties', listed_date: '2024-01-20', permit_number: 'LP-2024-06543', reference: 'REB-SV-TH-003', featured: 0, views: 876 },
    { id: 'prop-4', title: 'Prime Office Space in Hamra', description: 'Fully fitted office space on Hamra\'s main commercial street.', type: 'rent', property_type: 'office', price: 2500, price_unit: 'month', bedrooms: 0, bathrooms: 2, area: 150, area_unit: 'sqm', location: 'Hamra, Beirut', city: 'Beirut', neighborhood: 'Hamra', address: 'Hamra Main Street', latitude: 33.8938, longitude: 35.4821, amenities: 'Security,Covered Parking,Central A/C,Elevator,Reception Area,Server Room', furnished: 1, photos: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800|https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=800', agent_id: 'agent-2', agent_name: 'Nadine Rahme', agent_photo: 'https://i.pravatar.cc/150?u=agent2', agent_license: 'RL-31592', agency_name: 'Rahme Real Estate', listed_date: '2024-03-05', permit_number: 'LP-2024-09123', reference: 'REB-HM-OFF-004', featured: 0, views: 543 },
    { id: 'prop-5', title: 'Seafront Villa in Jounieh', description: 'Magnificent villa with private beach access and infinity pool.', type: 'sale', property_type: 'villa', price: 2500000, bedrooms: 5, bathrooms: 6, area: 450, area_unit: 'sqm', location: 'Jounieh', city: 'Jounieh', neighborhood: 'Kaslik', address: 'Kaslik Sea Road, Jounieh', latitude: 33.9808, longitude: 35.6158, amenities: 'Security,Private Pool,Private Beach,Central A/C,Balcony,Built in Wardrobes,Home Cinema,Wine Cellar,Staff Quarters,Garden', furnished: 0, photos: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800|https://images.unsplash.com/photo-1602343168117-bb8ffe3e2e9f?w=800', agent_id: 'agent-2', agent_name: 'Nadine Rahme', agent_photo: 'https://i.pravatar.cc/150?u=agent2', agent_license: 'RL-31592', agency_name: 'Rahme Real Estate', listed_date: '2024-02-28', permit_number: 'LP-2024-08876', reference: 'REB-JN-VL-005', featured: 1, views: 2156 },
    { id: 'prop-6', title: 'Stylish 2-Bedroom at Zaitunay Bay', description: 'Premium apartment in Beirut\'s most prestigious waterfront development.', type: 'sale', property_type: 'apartment', price: 650000, bedrooms: 2, bathrooms: 2, area: 140, area_unit: 'sqm', location: 'Zaitunay Bay, Beirut', city: 'Beirut', neighborhood: 'Zaitunay Bay', address: 'Zaitunay Bay Marina', latitude: 33.9013, longitude: 35.5020, amenities: 'Security,Covered Parking,Shared Gym,Shared Pool,Central A/C,Balcony,Marina Access,Concierge', furnished: 1, photos: 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=800|https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800', agent_id: 'agent-3', agent_name: 'Marc Khoury', agent_photo: 'https://i.pravatar.cc/150?u=agent3', agent_license: 'RL-19283', agency_name: 'Khoury Property Group', listed_date: '2024-03-10', permit_number: 'LP-2024-09432', reference: 'REB-ZB-2BR-006', featured: 1, views: 1678 },
    { id: 'prop-7', title: 'Cozy Studio in Gemayzeh', description: 'Charming studio in Beirut\'s vibrant Gemayzeh district.', type: 'rent', property_type: 'studio', price: 800, price_unit: 'month', bedrooms: 0, bathrooms: 1, area: 55, area_unit: 'sqm', location: 'Gemayzeh, Beirut', city: 'Beirut', neighborhood: 'Gemayzeh', address: 'Gouraud Street, Gemayzeh', latitude: 33.8912, longitude: 35.5123, amenities: 'Security,Central A/C,Balcony,Furnished', furnished: 1, photos: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800|https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800', agent_id: 'agent-1', agent_name: 'Karim Haddad', agent_photo: 'https://i.pravatar.cc/150?u=agent1', agent_license: 'RL-28471', agency_name: 'Haddad Premium Properties', listed_date: '2024-03-12', permit_number: 'LP-2024-09567', reference: 'REB-GM-ST-007', featured: 0, views: 432 },
    { id: 'prop-8', title: 'Retail Shop on Main Road in Jounieh', description: 'High-footfall retail space on Jounieh\'s main commercial road.', type: 'rent', property_type: 'shop', price: 3500, price_unit: 'month', bedrooms: 0, bathrooms: 1, area: 120, area_unit: 'sqm', location: 'Jounieh Main Road', city: 'Jounieh', neighborhood: 'Jounieh Center', address: 'Jounieh Main Road', latitude: 33.9820, longitude: 35.6170, amenities: 'Security,Storage Room,Display Windows', furnished: 0, photos: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800', agent_id: 'agent-2', agent_name: 'Nadine Rahme', agent_photo: 'https://i.pravatar.cc/150?u=agent2', agent_license: 'RL-31592', agency_name: 'Rahme Real Estate', listed_date: '2024-03-08', permit_number: 'LP-2024-09345', reference: 'REB-JN-SH-008', featured: 0, views: 321 },
    { id: 'prop-9', title: 'Family Villa with Garden in Baabda', description: 'Spacious family villa in the quiet hills of Baabda.', type: 'rent', property_type: 'villa', price: 4200, price_unit: 'month', bedrooms: 4, bathrooms: 4, area: 350, area_unit: 'sqm', location: 'Baabda', city: 'Baabda', neighborhood: 'Baabda Hills', address: 'Baabda Hills Road', latitude: 33.8333, longitude: 35.5333, amenities: 'Security,Private Garden,Parking,Central A/C,Balcony,Mountain View,Fireplace', furnished: 0, photos: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800|https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800', agent_id: 'agent-3', agent_name: 'Marc Khoury', agent_photo: 'https://i.pravatar.cc/150?u=agent3', agent_license: 'RL-19283', agency_name: 'Khoury Property Group', listed_date: '2024-02-20', permit_number: 'LP-2024-08432', reference: 'REB-BB-VL-009', featured: 0, views: 765 },
    { id: 'prop-10', title: 'Modern Apartment in Mar Mikhael', description: 'Trendy apartment in Beirut\'s coolest neighborhood.', type: 'rent', property_type: 'apartment', price: 1800, price_unit: 'month', bedrooms: 2, bathrooms: 2, area: 110, area_unit: 'sqm', location: 'Mar Mikhael, Beirut', city: 'Beirut', neighborhood: 'Mar Mikhael', address: 'Armenia Street, Mar Mikhael', latitude: 33.8895, longitude: 35.5225, amenities: 'Security,Central A/C,Balcony,Open Plan,Rooftop Access', furnished: 1, photos: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800|https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=800', agent_id: 'agent-3', agent_name: 'Marc Khoury', agent_photo: 'https://i.pravatar.cc/150?u=agent3', agent_license: 'RL-19283', agency_name: 'Khoury Property Group', listed_date: '2024-03-15', permit_number: 'LP-2024-09678', reference: 'REB-MM-2BR-010', featured: 0, views: 987 },
  ]
  for (const p of seedProperties) {
    await insert('properties', p)
  }

  const seedTransactions = [
    { id: 't1', property_id: 'prop-1', location: 'Achrafieh', deal_type: 'sale', date: '2024-03-15', property_type: 'Apartment', bedrooms: '3 Beds', price: 850000, area: 180, agent_id: 'agent-1' },
    { id: 't2', property_id: 'prop-2', location: 'Downtown Beirut', deal_type: 'rent', date: '2024-02-20', property_type: 'Penthouse', bedrooms: '4 Beds', price: 3600, area: 320, agent_id: 'agent-1' },
    { id: 't3', property_id: 'prop-3', location: 'Saifi Village', deal_type: 'sale', date: '2024-01-10', property_type: 'Townhouse', bedrooms: '4 Beds', price: 1200000, area: 280, agent_id: 'agent-1' },
    { id: 't4', property_id: 'prop-4', location: 'Hamra', deal_type: 'rent', date: '2024-03-01', property_type: 'Office', bedrooms: 'Studio', price: 2500, area: 150, agent_id: 'agent-2' },
    { id: 't5', property_id: 'prop-5', location: 'Jounieh', deal_type: 'sale', date: '2024-02-15', property_type: 'Villa', bedrooms: '5 Beds', price: 950000, area: 450, agent_id: 'agent-2' },
    { id: 't6', property_id: 'prop-6', location: 'Zaitunay Bay', deal_type: 'sale', date: '2024-03-20', property_type: 'Apartment', bedrooms: '2 Beds', price: 650000, area: 140, agent_id: 'agent-3' },
    { id: 't7', property_id: 'prop-9', location: 'Baabda', deal_type: 'rent', date: '2024-01-25', property_type: 'Villa', bedrooms: '6 Beds', price: 4200, area: 520, agent_id: 'agent-3' },
  ]
  for (const t of seedTransactions) {
    await insert('transactions', t)
  }

  const priceHistory = [
    { id: uuidv4(), property_id: 'prop-1', date: '2022-01-15', price: 720000, event: 'Listed' },
    { id: uuidv4(), property_id: 'prop-1', date: '2022-06-20', price: 695000, event: 'Price Drop' },
    { id: uuidv4(), property_id: 'prop-1', date: '2023-03-10', price: 750000, event: 'Relisted' },
    { id: uuidv4(), property_id: 'prop-1', date: '2023-09-05', price: 780000, event: 'Price Increase' },
    { id: uuidv4(), property_id: 'prop-1', date: '2024-03-01', price: 850000, event: 'Current Listing' },
    { id: uuidv4(), property_id: 'prop-2', date: '2023-01-10', price: 2500000, event: 'Listed' },
    { id: uuidv4(), property_id: 'prop-2', date: '2023-08-15', price: 2650000, event: 'Price Increase' },
    { id: uuidv4(), property_id: 'prop-2', date: '2024-02-15', price: 2800000, event: 'Current Listing' },
  ]
  for (const ph of priceHistory) {
    await insert('price_history', ph)
  }

  const reviews = [
    { id: uuidv4(), agent_id: 'agent-1', reviewer_name: 'Ahmad F.', rating: 5, comment: 'Karim was exceptional. Found us our dream home in Achrafieh within 2 weeks. Highly professional.', verified_transaction: 1 },
    { id: uuidv4(), agent_id: 'agent-1', reviewer_name: 'Sarah M.', rating: 5, comment: 'Best agent in Beirut. His knowledge of the market is unmatched.', verified_transaction: 1 },
    { id: uuidv4(), agent_id: 'agent-1', reviewer_name: 'Rami K.', rating: 4, comment: 'Great experience overall. Very responsive and helpful throughout the process.', verified_transaction: 1 },
    { id: uuidv4(), agent_id: 'agent-2', reviewer_name: 'Layla H.', rating: 5, comment: 'Nadine helped us find the perfect office space. Her commercial expertise is outstanding.', verified_transaction: 1 },
    { id: uuidv4(), agent_id: 'agent-3', reviewer_name: 'Fadi S.', rating: 5, comment: 'Marc has exclusive access to the best new developments. We got an amazing pre-launch deal.', verified_transaction: 1 },
  ]
  for (const r of reviews) {
    await insert('reviews', r)
  }

  const nstats = [
    { id: uuidv4(), name: 'Achrafieh', city: 'Beirut', avg_price: 720000, avg_size: 160, properties_listed: 45, price_min: 350000, price_max: 1500000, walk_score: 92, school_rating: 8.5, transit_score: 78, market_temp: 'Hot' },
    { id: uuidv4(), name: 'Downtown Beirut', city: 'Beirut', avg_price: 1800000, avg_size: 200, properties_listed: 23, price_min: 900000, price_max: 4500000, walk_score: 95, school_rating: 7.2, transit_score: 88, market_temp: 'Very Hot' },
    { id: uuidv4(), name: 'Saifi Village', city: 'Beirut', avg_price: 1100000, avg_size: 220, properties_listed: 18, price_min: 650000, price_max: 2500000, walk_score: 89, school_rating: 8.0, transit_score: 82, market_temp: 'Hot' },
    { id: uuidv4(), name: 'Hamra', city: 'Beirut', avg_price: 450000, avg_size: 120, properties_listed: 67, price_min: 180000, price_max: 900000, walk_score: 94, school_rating: 7.8, transit_score: 85, market_temp: 'Warm' },
    { id: uuidv4(), name: 'Jounieh', city: 'Jounieh', avg_price: 850000, avg_size: 280, properties_listed: 34, price_min: 400000, price_max: 2800000, walk_score: 65, school_rating: 7.0, transit_score: 55, market_temp: 'Warm' },
    { id: uuidv4(), name: 'Zaitunay Bay', city: 'Beirut', avg_price: 950000, avg_size: 150, properties_listed: 15, price_min: 550000, price_max: 3200000, walk_score: 91, school_rating: 7.5, transit_score: 80, market_temp: 'Hot' },
    { id: uuidv4(), name: 'Gemayzeh', city: 'Beirut', avg_price: 380000, avg_size: 95, properties_listed: 42, price_min: 150000, price_max: 750000, walk_score: 93, school_rating: 7.0, transit_score: 83, market_temp: 'Warm' },
    { id: uuidv4(), name: 'Mar Mikhael', city: 'Beirut', avg_price: 520000, avg_size: 110, properties_listed: 38, price_min: 220000, price_max: 980000, walk_score: 90, school_rating: 6.8, transit_score: 79, market_temp: 'Warm' },
    { id: uuidv4(), name: 'Baabda', city: 'Baabda', avg_price: 680000, avg_size: 300, properties_listed: 28, price_min: 350000, price_max: 1400000, walk_score: 45, school_rating: 6.5, transit_score: 35, market_temp: 'Cool' },
  ]
  for (const s of nstats) {
    await insert('neighborhood_stats', s)
  }
}
