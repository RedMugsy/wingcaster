/**
 * Postgres adapter integration tests.
 *
 * These tests require a running Postgres instance and DATABASE_URL to be set.
 * If DATABASE_URL is missing, the suite is skipped.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import pg from 'pg'
import * as postgresAdapter from './postgres-adapter.js'

const { Client } = pg

const databaseUrl = process.env.DATABASE_URL
const hasDatabaseUrl = Boolean(databaseUrl)

async function createTestDatabase() {
  const baseUrl = new URL(databaseUrl)
  const testDbName = `rebazaar_persistence_test_${Date.now()}_${randomUUID().slice(0, 8)}`
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'

  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    // Force disconnect any existing connections to the test DB if it exists.
    await client.query(`DROP DATABASE IF EXISTS ${testDbName}`)
    await client.query(`CREATE DATABASE ${testDbName}`)
  } finally {
    await client.end()
  }

  const testUrl = new URL(databaseUrl)
  testUrl.pathname = `/${testDbName}`
  return { testUrl: testUrl.toString(), testDbName }
}

async function dropTestDatabase(testDbName) {
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'
  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await client.query(`DROP DATABASE IF EXISTS ${testDbName}`)
  } finally {
    await client.end()
  }
}

describe.skipIf(!hasDatabaseUrl)('Postgres adapter', () => {
  let testDatabaseUrl = null
  let testDbName = null

  beforeAll(async () => {
    const created = await createTestDatabase()
    testDatabaseUrl = created.testUrl
    testDbName = created.testDbName
    postgresAdapter.configure({ databaseUrl: testDatabaseUrl, force: true })
    await postgresAdapter.loadDb()
  })

  afterAll(async () => {
    await postgresAdapter.closeDb()
    if (testDbName) {
      await dropTestDatabase(testDbName)
    }
  })

  beforeEach(async () => {
    const pool = postgresAdapter.getPool()
    await pool.query("DELETE FROM legacy_collections WHERE collection LIKE 'test_%'")
  })

  it('inserts and reads a record', async () => {
    const item = await postgresAdapter.insert('test_items', { name: 'alpha', value: 1 })
    expect(item.id).toBeTruthy()
    expect(item.name).toBe('alpha')

    const found = await postgresAdapter.findOne('test_items', (i) => i.id === item.id)
    expect(found).toBeTruthy()
    expect(found.name).toBe('alpha')
  })

  it('finds all records with a filter', async () => {
    await postgresAdapter.insert('test_items', { name: 'alpha', value: 1 })
    await postgresAdapter.insert('test_items', { name: 'beta', value: 2 })
    await postgresAdapter.insert('test_items', { name: 'gamma', value: 3 })

    const filtered = await postgresAdapter.findAll('test_items', (i) => i.value > 1)
    expect(filtered).toHaveLength(2)
  })

  it('updates records', async () => {
    const item = await postgresAdapter.insert('test_update_items', { name: 'a', value: 1 })
    const updated = await postgresAdapter.update(
      'test_update_items',
      (i) => i.id === item.id,
      (i) => ({ ...i, value: 99 }),
    )
    expect(updated).toBe(1)

    const found = await postgresAdapter.findOne('test_update_items', (i) => i.id === item.id)
    expect(found.value).toBe(99)
  })

  it('removes records', async () => {
    const keep = await postgresAdapter.insert('test_remove_items', { name: 'keep' })
    const gone = await postgresAdapter.insert('test_remove_items', { name: 'gone' })

    const removed = await postgresAdapter.remove('test_remove_items', (i) => i.id === gone.id)
    expect(removed).toBe(1)

    const remaining = await postgresAdapter.findAll('test_remove_items')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(keep.id)
  })

  it('upserts on duplicate id', async () => {
    const item = await postgresAdapter.insert('test_upsert_items', { id: 'shared-id', name: 'first' })
    expect(item.name).toBe('first')

    const updated = await postgresAdapter.insert('test_upsert_items', { id: 'shared-id', name: 'second' })
    expect(updated.name).toBe('second')

    const all = await postgresAdapter.findAll('test_upsert_items')
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('second')
  })

  it('runs transactions', async () => {
    const result = await postgresAdapter.transaction(async (client) => {
      const { rows } = await client.query('SELECT 1 + 1 AS sum')
      return rows[0].sum
    })
    expect(result).toBe(2)
  })
})
