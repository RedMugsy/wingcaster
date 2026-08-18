import { randomUUID } from 'node:crypto'

export const NOW = '2026-08-18T12:00:00.000Z'

export const ACCOUNT_TYPES = [
  'AVAILABLE', 'HELD', 'ISSUANCE', 'CONSUMED', 'EXPIRED', 'ADJUSTMENT', 'CLEARING',
]

export async function insertUser(client, { id, email, name }) {
  await client.query(
    `INSERT INTO users (id, email, name, data) VALUES ($1, $2, $3, '{}'::jsonb)`,
    [id, email, name],
  )
}

export async function insertPublicTenant(client, { id, ownerUserId, name }) {
  await client.query(
    `INSERT INTO tenants (
       id, tenant_type, personal_owner_user_id, name, status, settings, data
     ) VALUES ($1, 'personal', $2, $3, 'active', '{}'::jsonb, '{}'::jsonb)`,
    [id, ownerUserId, name],
  )
}

export async function seedPlatform(client) {
  const platformId = randomUUID()
  const liveEnvId = randomUUID()
  const testEnvId = randomUUID()
  const legalEntityId = randomUUID()
  await client.query(
    `INSERT INTO fin.platforms (
       id, code, name, created_at, updated_at
     ) VALUES ($1, 'WC', 'Wingcaster', $2, $2)`,
    [platformId, NOW],
  )
  await client.query(
    `INSERT INTO fin.environments (
       id, platform_id, code, clock_mode, created_at, updated_at
     ) VALUES
       ($1, $3, 'LIVE', 'WALL', $4, $4),
       ($2, $3, 'TEST', 'INJECTED', $4, $4)`,
    [liveEnvId, testEnvId, platformId, NOW],
  )
  await client.query(
    `INSERT INTO fin.platform_legal_entities (
       id, platform_id, code, legal_name, jurisdiction, tax_id,
       billing_currency, residency_key, created_at, updated_at
     ) VALUES ($1, $2, 'WC-KSA', 'Wingcaster KSA', 'SA', '3000000000',
               'SAR', 'ksa', $3, $3)`,
    [legalEntityId, platformId, NOW],
  )
  return { platformId, liveEnvId, testEnvId, legalEntityId }
}

export async function seedFinTenant(client, {
  environment = 'LIVE',
  platformId,
  legalEntityId,
  suffix,
}) {
  const userId = `u-${suffix}`
  const publicTenantId = `pt-${suffix}`
  await insertUser(client, {
    id: userId,
    email: `${suffix}@example.test`,
    name: `Fin ${suffix}`,
  })
  await insertPublicTenant(client, {
    id: publicTenantId,
    ownerUserId: userId,
    name: `Tenant ${suffix}`,
  })

  const tenantId = randomUUID()
  const holderId = randomUUID()
  const billingAccountId = randomUUID()
  await client.query(
    `INSERT INTO fin.tenants (
       id, environment, public_tenant_id, platform_id, default_legal_entity_id,
       default_residency_key, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'ksa', 'ACTIVE', $6, $6)`,
    [tenantId, environment, publicTenantId, platformId, legalEntityId, NOW],
  )
  await client.query(
    `INSERT INTO fin.holders (
       id, environment, tenant_id, holder_kind, display_name, created_at, updated_at
     ) VALUES ($1, $2, $3, 'TENANT_ROOT', $4, $5, $5)`,
    [holderId, environment, tenantId, `Holder ${suffix}`, NOW],
  )
  await client.query(
    `INSERT INTO fin.billing_accounts (
       id, environment, tenant_id, holder_id, seller_legal_entity_id,
       billing_currency, billing_timezone, invoice_delivery, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'USD', 'Asia/Riyadh', 'EMAIL', $6, $6)`,
    [billingAccountId, environment, tenantId, holderId, legalEntityId, NOW],
  )
  return {
    userId, publicTenantId, tenantId, holderId, billingAccountId, environment,
  }
}

export async function seedBook(client, {
  environment,
  tenantId,
  billingAccountId,
  bookType = 'CUSTOMER',
  currency = 'USD',
}) {
  const bookId = randomUUID()
  await client.query(
    `INSERT INTO fin.ledger_books (
       id, environment, tenant_id, billing_account_id, book_type, currency,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [bookId, environment, tenantId, billingAccountId, bookType, currency, NOW],
  )
  const accounts = {}
  for (const accountType of ACCOUNT_TYPES) {
    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.ledger_accounts (
         id, environment, book_id, account_type, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, environment, bookId, accountType, NOW],
    )
    accounts[accountType] = id
  }
  return { bookId, accounts, currency, bookType }
}

export async function seedExtraBillingAccount(client, {
  environment, tenantId, holderId, legalEntityId, currency = 'USD',
}) {
  const billingAccountId = randomUUID()
  await client.query(
    `INSERT INTO fin.billing_accounts (
       id, environment, tenant_id, holder_id, seller_legal_entity_id,
       billing_currency, billing_timezone, invoice_delivery, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'Asia/Riyadh', 'EMAIL', $7, $7)`,
    [billingAccountId, environment, tenantId, holderId, legalEntityId, currency, NOW],
  )
  return billingAccountId
}

export async function seedWorld(client) {
  const platform = await seedPlatform(client)
  const tenantA = await seedFinTenant(client, {
    ...platform, suffix: 'a', environment: 'LIVE',
  })
  const tenantB = await seedFinTenant(client, {
    ...platform, suffix: 'b', environment: 'LIVE',
  })
  const bookUsd = await seedBook(client, {
    environment: tenantA.environment,
    tenantId: tenantA.tenantId,
    billingAccountId: tenantA.billingAccountId,
    currency: 'USD',
  })
  const eurBa = await seedExtraBillingAccount(client, {
    environment: tenantA.environment,
    tenantId: tenantA.tenantId,
    holderId: tenantA.holderId,
    legalEntityId: platform.legalEntityId,
    currency: 'EUR',
  })
  const bookEur = await seedBook(client, {
    environment: tenantA.environment,
    tenantId: tenantA.tenantId,
    billingAccountId: eurBa,
    currency: 'EUR',
  })
  const sarBa = await seedExtraBillingAccount(client, {
    environment: tenantA.environment,
    tenantId: tenantA.tenantId,
    holderId: tenantA.holderId,
    legalEntityId: platform.legalEntityId,
    currency: 'SAR',
  })
  const bookSar = await seedBook(client, {
    environment: tenantA.environment,
    tenantId: tenantA.tenantId,
    billingAccountId: sarBa,
    currency: 'SAR',
  })
  const bookB = await seedBook(client, {
    environment: tenantB.environment,
    tenantId: tenantB.tenantId,
    billingAccountId: tenantB.billingAccountId,
    currency: 'USD',
  })
  return {
    now: NOW,
    ...platform,
    platform,
    tenantA: { ...tenantA, bookUsd, bookEur, bookSar, eurBa, sarBa },
    tenantB: { ...tenantB, bookB },
  }
}

export async function insertBalancedPostings(client, {
  environment, transactionId, bookId, accounts, debitType, creditType, units,
}) {
  await client.query(
    `INSERT INTO fin.ledger_postings (
       id, environment, transaction_id, book_id, account_id, amount_units, created_at
     ) VALUES
       ($1, $3, $4, $5, $6, $8, $10),
       ($2, $3, $4, $5, $7, $9, $10)`,
    [
      randomUUID(), randomUUID(),
      environment, transactionId, bookId,
      accounts[debitType], accounts[creditType],
      -units, units, NOW,
    ],
  )
}

export async function insertLedgerTx(client, fields) {
  const id = fields.id || randomUUID()
  await client.query(
    `INSERT INTO fin.ledger_transactions (
       id, environment, book_id, pair_id, fx_rate_snapshot_id, shape,
       economic_source_type, economic_source_id, actor_type, actor_id,
       reason_code, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      fields.environment,
      fields.bookId,
      fields.pairId || null,
      fields.fxRateSnapshotId || null,
      fields.shape,
      fields.economicSourceType || 'TEST',
      fields.economicSourceId || randomUUID(),
      fields.actorType || 'SYSTEM',
      fields.actorId || null,
      fields.reasonCode || 'TEST',
      fields.createdAt || NOW,
    ],
  )
  return id
}

export function commandEnv(world, extra = {}) {
  return {
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    holderId: world.tenantA.holderId,
    bookId: world.tenantA.bookUsd.bookId,
    reasonCode: extra.reasonCode || 'TEST',
    actorType: extra.actorType || 'SYSTEM',
    now: world.now,
    ...extra,
  }
}

export async function insertApproval(client, {
  tenantId,
  actionKind = 'LARGE_GRANT',
  status = 'APPROVED',
  environment = 'LIVE',
  now = NOW,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.approval_requests (
       id, environment, tenant_id, action_kind, status, payload_hash,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'test', $6, $6)`,
    [id, environment, tenantId, actionKind, status, now],
  )
  return id
}

export async function insertFxSnapshot(client, {
  base = 'USD',
  quote = 'EUR',
  num = 920000,
  den = 1000000,
  now = NOW,
} = {}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.fx_rate_snapshots (
       id, base_currency, quote_currency, rate_bps_num, rate_bps_den,
       source, effective_at, snapshot_kind
     ) VALUES ($1, $2, $3, $4, $5, 'TEST', $6, 'TRANSACTION')`,
    [id, base, quote, num, den, now],
  )
  return id
}

export async function asRole(client, role, gucs, fn) {
  await client.query('BEGIN')
  try {
    await client.query(`SET LOCAL ROLE ${role}`)
    for (const [key, value] of Object.entries(gucs || {})) {
      await client.query('SELECT set_config($1, $2, true)', [key, String(value)])
    }
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* already aborted */ }
    throw error
  }
}
