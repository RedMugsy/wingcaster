import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL
const hasDatabaseUrl = Boolean(databaseUrl)
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

async function createTestDatabase() {
  const testDbName = `rebazaar_tenant_test_${Date.now()}_${randomUUID().slice(0, 8)}`
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${testDbName}`)
  } finally {
    await admin.end()
  }
  const testUrl = new URL(databaseUrl)
  testUrl.pathname = `/${testDbName}`
  return { testDbName, testUrl: testUrl.toString() }
}

async function dropTestDatabase(testDbName) {
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${testDbName}`)
  } finally {
    await admin.end()
  }
}

async function runMigration(client, filename) {
  const sql = await readFile(join(migrationsDir, filename), 'utf8')
  await client.query(sql)
}

describe.skipIf(!hasDatabaseUrl)('tenant foundation migrations', () => {
  let client
  let testDbName

  beforeAll(async () => {
    const created = await createTestDatabase()
    testDbName = created.testDbName
    client = new Client({ connectionString: created.testUrl })
    await client.connect()

    const baseMigrations = [
      '001_create_migrations_table.sql',
      '002_identity_org.sql',
      '003_listings.sql',
      '004_crm.sql',
      '005_conversations.sql',
      '006_campaigns.sql',
      '007_distribution.sql',
      '008_notifications.sql',
      '009_audit_activity.sql',
      '010_templates_entitlements.sql',
      '011_wa_listings.sql',
      '012_legacy_collections.sql',
      '013_wa_audit_logs.sql',
      '014_ai_credit_balances_id.sql',
      '015_feature_entitlements_data.sql',
      '016_wa_listings_metadata_columns.sql',
      '017_auth_tables.sql',
      '018_drop_auth_user_fks.sql',
      '019_audit_activity_updated_at.sql',
      '020_opportunity_stage_history_timestamps.sql',
      '021_drop_consumer_automation_user_fk.sql',
      '022_drop_consumer_notifications_user_fk.sql',
      '023_area_intelligence.sql',
    ]
    for (const filename of baseMigrations) await runMigration(client, filename)

    await client.query(
      `INSERT INTO users (id, email, password_hash, role, data)
       VALUES ('user-1', 'one@example.test', 'stale-hash', 'admin', $1::jsonb)`,
      [JSON.stringify({ role: 'admin', token_version: 9, password_hash: 'stale-hash' })],
    )
    await client.query(
      `INSERT INTO agents (id, user_id, email, name, role, data)
       VALUES ('user-1', 'user-1', 'one@example.test', 'One', 'agent', $1::jsonb)`,
      [JSON.stringify({ role: 'agent', token_version: 2, password_hash: 'agent-hash' })],
    )

    await runMigration(client, '027_user_principals_notification_prefs.sql')
    await client.query(
      `INSERT INTO agencies (id, owner_id, name, data)
       VALUES ('legacy-agency', 'user-1', 'Legacy Agency', '{}'::jsonb)`,
    )
    await runMigration(client, '028_tenant_authorization_foundation.sql')
  }, 180000)

  afterAll(async () => {
    if (client) await client.end()
    if (testDbName) await dropTestDatabase(testDbName)
  }, 180000)

  it('keeps historical agent auth state authoritative without retaining legacy admin privilege', async () => {
    const { rows } = await client.query(
      `SELECT role, platform_role, password_hash, data->>'token_version' AS token_version
       FROM users WHERE id = 'user-1'`,
    )
    expect(rows[0]).toMatchObject({
      role: 'agent',
      platform_role: null,
      password_hash: 'agent-hash',
      token_version: '2',
    })
  })

  it('creates one durable personal tenant and owner membership per agent', async () => {
    const { rows } = await client.query(
      `SELECT tenant.tenant_type, membership.role, membership.affiliation_mode, membership.status
       FROM tenants tenant
       JOIN tenant_memberships membership ON membership.tenant_id = tenant.id
       WHERE tenant.id = 'personal:user-1'`,
    )
    expect(rows).toEqual([{
      tenant_type: 'personal',
      role: 'owner',
      affiliation_mode: 'personal',
      status: 'active',
    }])
  })

  it('restores transition-compatible ownership from explicit agency owner authority', async () => {
    const { rows } = await client.query(
      `SELECT canonical.role, canonical.affiliation_mode, legacy.role AS legacy_role
       FROM tenant_memberships canonical
       JOIN agency_members legacy ON legacy.id = canonical.legacy_agency_member_id
       WHERE canonical.tenant_id = 'agency:legacy-agency'
         AND canonical.status = 'active'`,
    )
    expect(rows).toEqual([{
      role: 'owner',
      affiliation_mode: 'exclusive',
      legacy_role: 'owner',
    }])
  })

  it('rejects invalid personal tenant memberships', async () => {
    await client.query(
      `INSERT INTO users (id, email, role, data)
       VALUES ('user-2', 'two@example.test', 'agent', '{}'::jsonb)`,
    )
    await expect(client.query(
      `INSERT INTO tenant_memberships (
         id, tenant_id, user_id, role, affiliation_mode, status
       ) VALUES (
         'invalid-personal-member', 'personal:user-1', 'user-2', 'member', 'non_exclusive', 'active'
       )`,
    )).rejects.toThrow('Personal tenants may only contain their canonical owner membership')
  })

  it('enforces one active exclusive agency membership per user', async () => {
    await client.query(
      `INSERT INTO users (id, email, role, data)
       VALUES ('user-3', 'three@example.test', 'agent', '{}'::jsonb)`,
    )
    await client.query(
      `INSERT INTO agencies (id, owner_id, name, data)
       VALUES ('agency-1', 'user-2', 'Agency One', '{}'::jsonb),
              ('agency-2', 'user-3', 'Agency Two', '{}'::jsonb)`,
    )
    await client.query(
      `INSERT INTO tenants (id, tenant_type, agency_id, name, data)
       VALUES ('agency:agency-1', 'agency', 'agency-1', 'Agency One', '{}'::jsonb),
              ('agency:agency-2', 'agency', 'agency-2', 'Agency Two', '{}'::jsonb)`,
    )
    await client.query(
      `INSERT INTO tenant_memberships (
         id, tenant_id, user_id, role, affiliation_mode, status
       ) VALUES
         ('owner-agency-1', 'agency:agency-1', 'user-2', 'owner', 'exclusive', 'active'),
         ('owner-agency-2', 'agency:agency-2', 'user-3', 'owner', 'exclusive', 'active')`,
    )
    await expect(client.query(
      `INSERT INTO tenant_memberships (
         id, tenant_id, user_id, role, affiliation_mode, status
       ) VALUES (
         'second-exclusive', 'agency:agency-2', 'user-2', 'member', 'exclusive', 'active'
       )`,
    )).rejects.toMatchObject({ code: '23505' })
  })

  it('prevents ending the last active tenant owner', async () => {
    await expect(client.query(
      `UPDATE tenant_memberships
       SET status = 'ended'
       WHERE id = 'owner-agency-1'`,
    )).rejects.toThrow('must retain at least one active owner')
  })
})
