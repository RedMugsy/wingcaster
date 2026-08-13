import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { loadDb, insert, closeDb } from '../src/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })

const jsonPath = process.env.JSON_DB_PATH || join(__dirname, '../data/db.json')

async function main() {
  if (!existsSync(jsonPath)) {
    console.log('No db.json found at', jsonPath, '- skipping migration')
    process.exit(0)
  }

  await loadDb()

  const raw = readFileSync(jsonPath, 'utf-8')
  const data = JSON.parse(raw)

  let total = 0
  for (const [collection, items] of Object.entries(data)) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      await insert(collection, item)
      total += 1
    }
    console.log(`Migrated ${items.length} items into ${collection}`)
  }

  console.log(`Migration complete: ${total} items imported`)
  await closeDb()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
