import { findOne, transaction, update } from './db.js'

export async function findUserById(userId) {
  return findOne('users', (user) => user.id === userId)
}

export async function findUserByEmail(email) {
  return findOne('users', (user) => user.email === email)
}

export async function findAgentForUser(userId) {
  return findOne('agents', (agent) => agent.user_id === userId)
}

export async function createAgentAccount({ user, agent }) {
  const now = new Date().toISOString()
  const principal = {
    ...user,
    id: user.id,
    created_at: user.created_at || now,
    updated_at: user.updated_at || now,
  }
  const profile = {
    ...agent,
    id: agent.id || principal.id,
    user_id: principal.id,
    created_at: agent.created_at || principal.created_at,
    updated_at: agent.updated_at || now,
  }

  if (profile.id !== principal.id) {
    throw new Error('Agent profiles must use the same id as their user principal')
  }

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO users (
        id, email, phone, name, password_hash, role, platform_role, created_at, updated_at, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::jsonb)`,
      [
        principal.id,
        principal.email,
        principal.phone || null,
        principal.name || null,
        principal.password_hash || null,
        principal.role || 'agent',
        principal.platform_role || null,
        principal.created_at,
        principal.updated_at,
        JSON.stringify(principal),
      ],
    )

    await client.query(
      `INSERT INTO agents (
        id, user_id, email, phone, name, slug, agency_id, role, verified,
        subscription_features, cta_config, created_at, updated_at, data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::jsonb, $12::timestamptz, $13::timestamptz, $14::jsonb
      )`,
      [
        profile.id,
        profile.user_id,
        profile.email,
        profile.phone || null,
        profile.name || null,
        profile.slug || null,
        profile.agency_id || null,
        profile.role || principal.role || 'agent',
        Boolean(profile.verified),
        profile.subscription_features ? JSON.stringify(profile.subscription_features) : null,
        profile.cta_config ? JSON.stringify(profile.cta_config) : null,
        profile.created_at,
        profile.updated_at,
        JSON.stringify(profile),
      ],
    )

    const tenantId = `personal:${principal.id}`
    const membershipId = `personal-membership:${principal.id}`
    const tenantName = principal.name || principal.email || 'Personal workspace'
    const tenant = {
      id: tenantId,
      tenant_type: 'personal',
      personal_owner_user_id: principal.id,
      name: tenantName,
      status: 'active',
      settings: { workspace_mode: 'active' },
      created_at: principal.created_at,
      updated_at: principal.updated_at,
    }
    const membership = {
      id: membershipId,
      tenant_id: tenantId,
      user_id: principal.id,
      role: 'owner',
      affiliation_mode: 'personal',
      status: 'active',
      public_profile: true,
      lead_eligible: true,
      capabilities: {},
      joined_at: principal.created_at,
      created_at: principal.created_at,
      updated_at: principal.updated_at,
    }

    await client.query(
      `INSERT INTO tenants (
        id, tenant_type, personal_owner_user_id, name, status, settings,
        created_at, updated_at, data
      ) VALUES (
        $1, 'personal', $2, $3, 'active', $4::jsonb,
        $5::timestamptz, $6::timestamptz, $7::jsonb
      )`,
      [
        tenantId,
        principal.id,
        tenantName,
        JSON.stringify(tenant.settings),
        principal.created_at,
        principal.updated_at,
        JSON.stringify(tenant),
      ],
    )
    await client.query(
      `INSERT INTO tenant_memberships (
        id, tenant_id, user_id, role, affiliation_mode, status, public_profile,
        lead_eligible, capabilities, joined_at, created_at, updated_at, data
      ) VALUES (
        $1, $2, $3, 'owner', 'personal', 'active', true,
        true, '{}'::jsonb, $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::jsonb
      )`,
      [
        membershipId,
        tenantId,
        principal.id,
        principal.created_at,
        principal.updated_at,
        JSON.stringify(membership),
      ],
    )
  })

  return { user: principal, agent: profile }
}

export async function updateUser(userId, patch) {
  const changed = await update('users', (user) => user.id === userId, (user) => ({
    ...user,
    ...patch,
    updated_at: new Date().toISOString(),
  }))
  return changed > 0 ? findUserById(userId) : null
}

export async function updatePlatformRole(userId, platformRole) {
  if (platformRole !== null && platformRole !== 'platform_admin') {
    throw new Error('Platform role must be platform_admin or null')
  }

  const updatedAt = new Date().toISOString()
  await transaction(async (client) => {
    const userResult = await client.query(
      `UPDATE users
       SET platform_role = $2,
           updated_at = $3::timestamptz,
           data = jsonb_set(
             CASE
               WHEN $2::text IS NULL THEN COALESCE(data, '{}'::jsonb) - 'platform_role'
               ELSE jsonb_set(COALESCE(data, '{}'::jsonb), '{platform_role}', to_jsonb($2::text), true)
             END,
             '{token_version}',
             to_jsonb(COALESCE((data->>'token_version')::integer, 0) + 1),
             true
           )
       WHERE id = $1`,
      [userId, platformRole, updatedAt],
    )
    if (userResult.rowCount !== 1) throw new Error('User not found')
  })
}
