import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { describe } from 'vitest'
import { runMigrations } from '../persistence/migrations/runner.js'

const { Pool } = pg
let skipNoticePrinted = false

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function schemaName(name) {
  const normalized = String(name || `test_${randomBytes(8).toString('hex')}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
  const prefixed = normalized.startsWith('test_') ? normalized : `test_${normalized}`
  return prefixed.slice(0, 42)
}

function urlWithSearchPath(databaseUrl, schemas) {
  const url = new URL(databaseUrl)
  const searchPath = [...Object.values(schemas), 'public'].map(identifier).join(',')
  url.searchParams.set('options', `-c search_path=${searchPath}`)
  return url.toString()
}

export async function verifyPostGIS(pool) {
  try {
    const { rows } = await pool.query('SELECT PostGIS_Version() AS version')
    if (!rows[0]?.version) {
      throw new Error('PostGIS extension not installed on this database')
    }
    return rows[0].version
  } catch (error) {
    if (error.code === '42883') {
      throw new Error('PostGIS extension not installed on this database')
    }
    throw error
  }
}

export async function createTestDatabase(name) {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for real-Postgres tests')
  }

  const root = schemaName(name)
  const schemas = {
    public: root,
    area_intelligence: `${root}_area`,
    market_pricing: `${root}_market`,
    commercial: `${root}_commercial`,
  }
  const adminPool = new Pool({ connectionString: databaseUrl })
  const schemaList = Object.values(schemas)

  try {
    await verifyPostGIS(adminPool)
    for (const schema of schemaList) {
      await adminPool.query(`CREATE SCHEMA ${identifier(schema)}`)
    }
  } catch (error) {
    for (const schema of [...schemaList].reverse()) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`).catch(() => {})
    }
    await adminPool.end()
    throw error
  }

  const url = urlWithSearchPath(databaseUrl, schemas)
  const migrationPool = new Pool({ connectionString: url })

  try {
    await runMigrations({ pool: migrationPool, schemaMap: schemas })
  } catch (error) {
    await migrationPool.end()
    for (const schema of [...schemaList].reverse()) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`).catch(() => {})
    }
    await adminPool.end()
    throw error
  }

  let tornDown = false
  return {
    url,
    schema: root,
    schemas,
    async teardown() {
      if (tornDown) return
      tornDown = true
      await migrationPool.end()
      try {
        for (const schema of [...schemaList].reverse()) {
          await adminPool.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`)
        }
      } finally {
        await adminPool.end()
      }
    },
  }
}

export async function withTestDb(fn) {
  const database = await createTestDatabase()
  try {
    return await fn(database.url, database)
  } finally {
    await database.teardown()
  }
}

export function skipIfNoPostgres() {
  const unavailable = !process.env.TEST_DATABASE_URL
  if (unavailable && !skipNoticePrinted) {
    skipNoticePrinted = true
    console.warn('REQUIRES REAL POSTGRES: TEST_DATABASE_URL not set — suite not run')
  }
  return describe.skipIf(unavailable)
}
