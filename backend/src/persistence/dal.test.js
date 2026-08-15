import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import pg from 'pg'
import { loadDb, closeDb, getDb, findAll, findOne, insert, update, remove, transaction, configure } from './index.js'
import { skipIfNoPostgres } from '../testing/postgres.js'

const { Client } = pg

const databaseUrl = process.env.TEST_DATABASE_URL

async function createTestDatabase() {
  const baseUrl = new URL(databaseUrl)
  const testDbName = `rebazaar_dal_test_${Date.now()}_${randomUUID().slice(0, 8)}`
  const adminUrl = new URL(databaseUrl)
  adminUrl.pathname = '/postgres'

  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
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

skipIfNoPostgres()('persistence DAL contract', () => {
  let testDatabaseUrl = null
  let testDbName = null

  beforeAll(async () => {
    const created = await createTestDatabase()
    testDatabaseUrl = created.testUrl
    testDbName = created.testDbName
    configure({ databaseUrl: testDatabaseUrl, force: true })
    await loadDb()
  }, 180000)

  afterAll(async () => {
    await closeDb()
    if (testDbName) {
      await dropTestDatabase(testDbName)
    }
  }, 180000)

  it('creates schema on loadDb', async () => {
    const db = await getDb()
    expect(db).toBeDefined()
    expect(typeof db).toBe('object')
  })

  it('inserts and finds one record', async () => {
    const inserted = await insert('test_items', { name: 'first', value: 1 })
    expect(inserted.id).toBeDefined()
    expect(inserted.name).toBe('first')

    const found = await findOne('test_items', (i) => i.name === 'first')
    expect(found).toBeDefined()
    expect(found.id).toBe(inserted.id)
  })

  it('findAll without filter returns all records', async () => {
    await insert('test_items', { name: 'alpha' })
    await insert('test_items', { name: 'beta' })
    const all = await findAll('test_items')
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('findAll with filter returns only matching records', async () => {
    const items = await findAll('test_items', (i) => i.name === 'beta')
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items[0].name).toBe('beta')
  })

  it('update mutates only matching rows', async () => {
    await insert('update_items', { name: 'a', value: 1 })
    await insert('update_items', { name: 'b', value: 2 })

    const changed = await update(
      'update_items',
      (i) => i.name === 'a',
      (i) => ({ ...i, value: 99 }),
    )
    expect(changed).toBe(1)

    const a = await findOne('update_items', (i) => i.name === 'a')
    const b = await findOne('update_items', (i) => i.name === 'b')
    expect(a.value).toBe(99)
    expect(b.value).toBe(2)
  })

  it('remove deletes only matching rows', async () => {
    await insert('remove_items', { name: 'keep' })
    await insert('remove_items', { name: 'delete' })

    const removed = await remove('remove_items', (i) => i.name === 'delete')
    expect(removed).toBe(1)

    const remaining = await findAll('remove_items')
    expect(remaining.length).toBe(1)
    expect(remaining[0].name).toBe('keep')
  })

  it('transaction runs multiple ops atomically', async () => {
    const result = await transaction(async () => {
      const first = await insert('tx_items', { name: 'first' })
      await update(
        'tx_items',
        (i) => i.id === first.id,
        (i) => ({ ...i, processed: true }),
      )
      return first.id
    })

    const item = await findOne('tx_items', (i) => i.id === result)
    expect(item).toBeDefined()
    expect(item.processed).toBe(true)
  })

  it('preserves data after close and reopen', async () => {
    const inserted = await insert('persist_items', { name: 'survive' })
    const id = inserted.id

    await closeDb()
    await loadDb()

    const found = await findOne('persist_items', (i) => i.id === id)
    expect(found).toBeDefined()
    expect(found.name).toBe('survive')
  })
})
