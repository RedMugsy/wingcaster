import { randomUUID } from 'crypto'
import { findAll, findOne, transaction } from './db.js'

export const TENANT_ROLES = Object.freeze(['owner', 'admin', 'member', 'guest'])
export const AFFILIATION_MODES = Object.freeze(['personal', 'exclusive', 'non_exclusive'])

export function personalTenantId(userId) {
  return `personal:${userId}`
}

export function agencyTenantId(agencyId) {
  return `agency:${agencyId}`
}

export function normalizeAgencyMembershipInput({ role, affiliationMode }) {
  const normalizedRole = role === 'agent' ? 'member' : role
  if (!['admin', 'member', 'guest'].includes(normalizedRole)) {
    throw new Error('Agency membership role must be admin, member, or guest')
  }
  if (!['exclusive', 'non_exclusive'].includes(affiliationMode)) {
    throw new Error('affiliation_mode must be exclusive or non_exclusive')
  }
  if (normalizedRole === 'guest' && affiliationMode !== 'non_exclusive') {
    throw new Error('Guest memberships must be non_exclusive')
  }
  if (normalizedRole === 'admin' && affiliationMode !== 'exclusive') {
    throw new Error('Admin memberships must be exclusive')
  }
  return { role: normalizedRole, affiliationMode }
}

export async function getAgencyMembership(agencyId, userId, { statuses = ['active'] } = {}) {
  const tenantId = agencyTenantId(agencyId)
  return (await findOne(
    'tenant_memberships',
    (membership) =>
      membership.tenant_id === tenantId &&
      membership.user_id === userId &&
      statuses.includes(membership.status),
  )) || null
}

export async function listUserAgencyMemberships(userId, { statuses = ['active'] } = {}) {
  const memberships = await findAll(
    'tenant_memberships',
    (membership) =>
      membership.user_id === userId &&
      membership.affiliation_mode !== 'personal' &&
      statuses.includes(membership.status),
  )
  const agencies = await findAll('agencies')
  const agencyById = new Map(agencies.map((agency) => [agency.id, agency]))
  return memberships.map((membership) => {
    const agencyId = String(membership.tenant_id).startsWith('agency:')
      ? String(membership.tenant_id).slice('agency:'.length)
      : null
    return {
      ...membership,
      agency_id: agencyId,
      agency: agencyId ? agencyById.get(agencyId) || null : null,
    }
  })
}

export async function listAgencyMemberships(agencyId, { statuses = ['active'] } = {}) {
  const tenantId = agencyTenantId(agencyId)
  return findAll(
    'tenant_memberships',
    (membership) => membership.tenant_id === tenantId && statuses.includes(membership.status),
  )
}

export async function createAgencyWithOwner({ agency, ownerUserId, membershipId = randomUUID() }) {
  if (!agency?.id || !agency?.name || !ownerUserId) {
    throw new Error('agency id, agency name, and owner user id are required')
  }
  const tenantId = agencyTenantId(agency.id)
  const now = agency.created_at || new Date().toISOString()
  const legacyMembership = {
    id: membershipId,
    agency_id: agency.id,
    user_id: ownerUserId,
    role: 'owner',
    status: 'active',
    joined_at: now,
    invited_by: ownerUserId,
    created_at: now,
    updated_at: now,
  }
  const tenant = {
    id: tenantId,
    tenant_type: 'agency',
    agency_id: agency.id,
    name: agency.name,
    slug: agency.slug || null,
    status: 'active',
    settings: {
      exclusive_personal_workspace_mode: 'read_only',
      default_non_exclusive_role: 'member',
    },
    created_at: now,
    updated_at: now,
  }
  const membership = {
    id: `agency-membership:${membershipId}`,
    tenant_id: tenantId,
    user_id: ownerUserId,
    role: 'owner',
    affiliation_mode: 'exclusive',
    status: 'active',
    public_profile: true,
    lead_eligible: true,
    capabilities: {},
    legacy_agency_member_id: membershipId,
    invited_by: ownerUserId,
    joined_at: now,
    created_at: now,
    updated_at: now,
  }

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO agencies (
        id, owner_id, name, slug, license_number, site_hosting_type, cta_config,
        created_at, updated_at, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz, $10::jsonb)`,
      [
        agency.id,
        ownerUserId,
        agency.name,
        agency.slug || null,
        agency.license_number || null,
        agency.site_hosting_type || 'none',
        JSON.stringify(agency.cta_config || {}),
        now,
        agency.updated_at || now,
        JSON.stringify({ ...agency, owner_id: ownerUserId }),
      ],
    )
    await client.query(
      `INSERT INTO tenants (
        id, tenant_type, agency_id, name, slug, status, settings,
        created_at, updated_at, data
      ) VALUES (
        $1, 'agency', $2, $3, $4, 'active', $5::jsonb,
        $6::timestamptz, $7::timestamptz, $8::jsonb
      )`,
      [
        tenant.id,
        agency.id,
        agency.name,
        agency.slug || null,
        JSON.stringify(tenant.settings),
        now,
        agency.updated_at || now,
        JSON.stringify(tenant),
      ],
    )
    await client.query(
      `INSERT INTO agency_members (
        id, agency_id, user_id, role, status, joined_at, created_at, updated_at, data
      ) VALUES ($1, $2, $3, 'owner', 'active', $4::timestamptz, $4::timestamptz, $4::timestamptz, $5::jsonb)`,
      [membershipId, agency.id, ownerUserId, now, JSON.stringify(legacyMembership)],
    )
    await client.query(
      `INSERT INTO tenant_memberships (
        id, tenant_id, user_id, role, affiliation_mode, status, public_profile,
        lead_eligible, capabilities, legacy_agency_member_id, invited_by, joined_at,
        created_at, updated_at, data
      ) VALUES (
        $1, $2, $3, 'owner', 'exclusive', 'active', true,
        true, '{}'::jsonb, $4, $3, $5::timestamptz,
        $5::timestamptz, $5::timestamptz, $6::jsonb
      )`,
      [membership.id, tenantId, ownerUserId, membershipId, now, JSON.stringify(membership)],
    )
  })

  return { agency, tenant, membership, legacyMembership }
}

export async function addAgencyMembership({
  agencyId,
  userId,
  role,
  affiliationMode,
  invitedBy,
  status = 'active',
  membershipId = randomUUID(),
}) {
  const normalized = normalizeAgencyMembershipInput({ role, affiliationMode })
  if (!agencyId || !userId || !invitedBy) {
    throw new Error('agency id, user id, and invited by are required')
  }
  if (!['invited', 'active'].includes(status)) {
    throw new Error('New memberships must be invited or active')
  }

  const tenantId = agencyTenantId(agencyId)
  const now = new Date().toISOString()
  const legacyRole = normalized.role
  const legacyMembership = {
    id: membershipId,
    agency_id: agencyId,
    user_id: userId,
    role: legacyRole,
    status,
    invited_by: invitedBy,
    invited_at: now,
    joined_at: status === 'active' ? now : null,
    created_at: now,
    updated_at: now,
  }
  const membership = {
    id: `agency-membership:${membershipId}`,
    tenant_id: tenantId,
    user_id: userId,
    role: normalized.role,
    affiliation_mode: normalized.affiliationMode,
    status,
    public_profile: normalized.role !== 'guest',
    lead_eligible: status === 'active' && normalized.role !== 'guest',
    capabilities: {},
    legacy_agency_member_id: membershipId,
    invited_by: invitedBy,
    joined_at: status === 'active' ? now : null,
    created_at: now,
    updated_at: now,
  }

  await transaction(async (client) => {
    const tenantResult = await client.query(
      `SELECT id FROM tenants WHERE id = $1 AND tenant_type = 'agency' AND status = 'active' FOR SHARE`,
      [tenantId],
    )
    if (tenantResult.rowCount !== 1) throw new Error('Active agency tenant not found')

    await client.query(
      `INSERT INTO agency_members (
        id, agency_id, user_id, role, status, joined_at, created_at, updated_at, data
      ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $7::timestamptz, $8::jsonb)`,
      [
        membershipId,
        agencyId,
        userId,
        legacyRole,
        status,
        legacyMembership.joined_at,
        now,
        JSON.stringify(legacyMembership),
      ],
    )
    await client.query(
      `INSERT INTO tenant_memberships (
        id, tenant_id, user_id, role, affiliation_mode, status, public_profile,
        lead_eligible, capabilities, legacy_agency_member_id, invited_by, joined_at,
        created_at, updated_at, data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb, $9, $10,
        $11::timestamptz, $12::timestamptz, $12::timestamptz, $13::jsonb
      )`,
      [
        membership.id,
        tenantId,
        userId,
        membership.role,
        membership.affiliation_mode,
        status,
        membership.public_profile,
        membership.lead_eligible,
        membershipId,
        invitedBy,
        membership.joined_at,
        now,
        JSON.stringify(membership),
      ],
    )
  })

  return { membership, legacyMembership }
}

export async function updateAgencyMembership({
  agencyId,
  membershipId,
  role,
  affiliationMode,
  publicProfile,
  leadEligible,
  capabilities,
}) {
  if (!agencyId || !membershipId) throw new Error('agency id and membership id are required')
  const tenantId = agencyTenantId(agencyId)
  const now = new Date().toISOString()

  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *
       FROM tenant_memberships
       WHERE tenant_id = $1
         AND (id = $2 OR legacy_agency_member_id = $2)
       FOR UPDATE`,
      [tenantId, membershipId],
    )
    const current = rows[0]
    if (!current) throw new Error('Membership not found')
    if (current.status !== 'active') throw new Error('Only active memberships can be updated')
    if (current.role === 'owner') {
      throw new Error('Owner membership changes require the ownership transfer workflow')
    }

    const normalized = normalizeAgencyMembershipInput({
      role: role || current.role,
      affiliationMode: affiliationMode || current.affiliation_mode,
    })
    const nextPublicProfile = publicProfile === undefined
      ? current.public_profile
      : Boolean(publicProfile)
    const nextLeadEligible = leadEligible === undefined
      ? current.lead_eligible
      : Boolean(leadEligible)
    const nextCapabilities = capabilities === undefined
      ? current.capabilities || {}
      : capabilities

    await client.query(
      `UPDATE tenant_memberships
       SET role = $2,
           affiliation_mode = $3,
           public_profile = $4,
           lead_eligible = $5,
           capabilities = $6::jsonb,
           updated_at = $7::timestamptz,
           data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
             'role', $2::text,
             'affiliation_mode', $3::text,
             'public_profile', $4::boolean,
             'lead_eligible', $5::boolean,
             'capabilities', $6::jsonb
           )
       WHERE id = $1`,
      [
        current.id,
        normalized.role,
        normalized.affiliationMode,
        nextPublicProfile,
        nextLeadEligible,
        JSON.stringify(nextCapabilities),
        now,
      ],
    )
    if (current.legacy_agency_member_id) {
      await client.query(
        `UPDATE agency_members
         SET role = $2,
             updated_at = $3::timestamptz,
             data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
               'role', $2::text,
               'affiliation_mode', $4::text,
               'public_profile', $5::boolean,
               'lead_eligible', $6::boolean,
               'capabilities', $7::jsonb
             )
         WHERE id = $1`,
        [
          current.legacy_agency_member_id,
          normalized.role,
          now,
          normalized.affiliationMode,
          nextPublicProfile,
          nextLeadEligible,
          JSON.stringify(nextCapabilities),
        ],
      )
    }

    return {
      ...current,
      role: normalized.role,
      affiliation_mode: normalized.affiliationMode,
      public_profile: nextPublicProfile,
      lead_eligible: nextLeadEligible,
      capabilities: nextCapabilities,
      updated_at: now,
    }
  })
}

export async function endAgencyMembership({ agencyId, membershipId, endedBy, reason = 'departure' }) {
  if (!agencyId || !membershipId || !endedBy) {
    throw new Error('agency id, membership id, and ended by are required')
  }
  const tenantId = agencyTenantId(agencyId)
  const now = new Date().toISOString()

  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *
       FROM tenant_memberships
       WHERE tenant_id = $1
         AND (id = $2 OR legacy_agency_member_id = $2)
       FOR UPDATE`,
      [tenantId, membershipId],
    )
    const membership = rows[0]
    if (!membership) throw new Error('Membership not found')
    if (membership.status !== 'active') throw new Error('Membership is not active')

    await client.query(
      `UPDATE tenant_memberships
       SET status = 'ended',
           ended_at = $2::timestamptz,
           end_reason = $3,
           updated_at = $2::timestamptz,
           data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
             'status', 'ended',
             'ended_at', $2::text,
             'ended_by', $4::text,
             'end_reason', $3::text
           )
       WHERE id = $1`,
      [membership.id, now, reason, endedBy],
    )
    if (membership.legacy_agency_member_id) {
      await client.query(
        `UPDATE agency_members
         SET status = 'ended',
             ended_at = $2::timestamptz,
             end_reason = $3,
             updated_at = $2::timestamptz,
             data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
               'status', 'ended',
               'ended_at', $2::text,
               'ended_by', $4::text,
               'end_reason', $3::text
             )
         WHERE id = $1`,
        [membership.legacy_agency_member_id, now, reason, endedBy],
      )
    }

    return { ok: true, membership_id: membership.id, ended_at: now }
  })
}