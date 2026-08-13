// Pre-migration data-hygiene check for migrations 027 and 028.
//
// Run this against a restored production database BEFORE applying
// 027_user_principals_notification_prefs.sql or
// 028_tenant_authorization_foundation.sql. It enumerates every state
// that will cause those migrations to halt or fail, prints the
// offending rows, and (when possible) prints suggested cleanup SQL
// as comments so a human can decide what to do.
//
// Exit code: 0 = all clear, 1 = one or more failures.
//
// Usage:
//   DATABASE_URL=postgres://... node backend/scripts/pre-migration-027-028-check.js
//   DATABASE_URL=postgres://... node backend/scripts/pre-migration-027-028-check.js --json > report.json

import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import pg from 'pg'

// Deliberately use pg directly rather than backend/src/db.js: the barrel's
// query() calls loadDb() which runs pending migrations. This script MUST NOT
// trigger migrations — it validates the database is safe to migrate.

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })

const jsonOutput = process.argv.includes('--json')

const checks = []
let pool

async function query(sql, params) {
  const { rows } = await pool.query(sql, params)
  return { rows }
}

async function closeDb() {
  if (pool) await pool.end()
}

function record(name, description, rows, cleanupSql) {
  checks.push({
    name,
    description,
    failed: rows.length > 0,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 10),
    cleanupSql: cleanupSql || null,
  })
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Point it at the target database (a restored production copy is recommended).')
    process.exit(2)
  }

  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=require|render\.com|railway\.app/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  })

  // ─── 027 fail-closed guard 1: email → mismatched user id ───────────────
  {
    const r = await query(
      `SELECT a.id AS agent_id, u.id AS user_id, a.email
         FROM agents a
         JOIN users u ON lower(u.email) = lower(a.email)
        WHERE u.id <> a.id
        ORDER BY a.email`
    )
    record(
      'agents_email_matches_different_user_id',
      "Migration 027 line ~10 halts if an agent shares an email with a user whose id differs. Reconcile by deciding whether the user or the agent id should win; this is a schema-shape decision.",
      r.rows,
      null
    )
  }

  // ─── 027 fail-closed guard 2: agents.user_id set but not = agents.id ────
  {
    const r = await query(
      `SELECT id AS agent_id, user_id, email
         FROM agents
        WHERE user_id IS NOT NULL AND user_id <> id
        ORDER BY email`
    )
    record(
      'agents_user_id_diverges_from_id',
      "Migration 027 halts if agents.user_id is set but not equal to agents.id. Under the canonical model, agent.id becomes the shared user principal id.",
      r.rows,
      `-- Nullify divergent user_id so 027 can canonicalize (agents.user_id will be set = id):
UPDATE agents SET user_id = NULL WHERE user_id IS NOT NULL AND user_id <> id;`
    )
  }

  // ─── 027 fail-closed guard 3: agency_members user_id/agent_id mismatch ─
  {
    const r = await query(
      `SELECT id, user_id, agent_id, agency_id, role, status
         FROM agency_members
        WHERE user_id IS NOT NULL
          AND agent_id IS NOT NULL
          AND user_id <> agent_id
        ORDER BY agency_id, user_id`
    )
    record(
      'agency_members_user_id_ne_agent_id',
      "Migration 027 halts if any agency_members row has BOTH user_id and agent_id set but different. These indicate a data-model split that must be manually resolved.",
      r.rows,
      null
    )
  }

  // ─── 028 fail-closed guard: legacy role='admin' accounts ────────────────
  {
    const r = await query(
      `SELECT 'users' AS source, id, email, role
         FROM users
        WHERE role = 'admin'
        UNION ALL
       SELECT 'agents' AS source, id, email, role
         FROM agents
        WHERE role = 'admin'
        ORDER BY email`
    )
    record(
      'legacy_admin_role_accounts',
      "Migration 028 lines 12-24 halt if ANY user OR agent has role='admin'. Each such account must be explicitly re-classified as platform_admin OR demoted to the appropriate role BEFORE the migration is applied. This is a security-sensitive decision.",
      r.rows,
      `-- For each row above, choose ONE:
-- (a) Promote to platform_admin explicitly:
--   UPDATE users SET role = 'platform_admin' WHERE id = '<row-id>';
--   UPDATE agents SET role = 'agent'         WHERE id = '<row-id>';
-- (b) Demote to standard agent (loses admin privileges):
--   UPDATE users SET role = 'agent' WHERE id = '<row-id>';
--   UPDATE agents SET role = 'agent' WHERE id = '<row-id>';
-- Never mass-update these without human review.`
    )
  }

  // ─── 027 FK restoration risks ───────────────────────────────────────────
  // After 027 backfills agents into users, the effective users(id) set is
  //   (SELECT id FROM users) UNION (SELECT id FROM agents)
  // An orphan is any user_id value in the target table that lies outside
  // that union.
  const fkTargets = [
    { table: 'agencies', column: 'owner_id', onDelete: 'SET NULL' },
    { table: 'agency_members', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'auth_recovery_tokens', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'account_recovery_cases', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'consumer_notifications', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'consumer_automation_checkpoints', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'otp_verifications', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'consumer_notification_prefs', column: 'user_id', onDelete: 'CASCADE' },
  ]

  for (const { table, column, onDelete } of fkTargets) {
    const r = await query(
      `SELECT ${column} AS orphan_user_id, COUNT(*) AS row_count
         FROM ${table} t
        WHERE t.${column} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.${column})
          AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.id = t.${column})
        GROUP BY ${column}
        ORDER BY row_count DESC`
    ).catch((err) => {
      // Table may not exist in some environments (defensive).
      return { rows: [], error: err.message }
    })
    const cleanup = onDelete === 'CASCADE'
      ? `-- CASCADE FK: orphan rows below CANNOT be silently nulled because the column is NOT NULL after 027.
-- Choose ONE per orphan_user_id:
-- (a) Delete the orphaned rows (destructive but matches CASCADE semantics):
--   DELETE FROM ${table} WHERE ${column} = '<orphan_user_id>';
-- (b) Create a placeholder user for the orphan (preserves data):
--   Consult ops before doing this.`
      : `-- SET NULL FK: null the orphan user_id values so 027 can restore the constraint cleanly:
--   UPDATE ${table} SET ${column} = NULL WHERE ${column} = '<orphan_user_id>';
-- Or, if the row itself is worthless, delete it:
--   DELETE FROM ${table} WHERE ${column} = '<orphan_user_id>';`
    record(
      `orphan_${table}_${column}`,
      `${table}.${column} → users(id) FK is re-added by 027 (${onDelete}). Rows whose ${column} does not reference a real user (and would not be backfilled as one from agents) will halt the migration.`,
      r.rows,
      cleanup
    )
  }

  // ─── Report ─────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => c.failed)

  if (jsonOutput) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      database_url: process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@'),
      total_checks: checks.length,
      failed_checks: failed.length,
      status: failed.length === 0 ? 'CLEAR_TO_MIGRATE' : 'BLOCKED',
      checks,
    }, null, 2))
  } else {
    console.log('')
    console.log('═'.repeat(72))
    console.log('  Pre-migration check for 027 + 028')
    console.log(`  Ran ${checks.length} checks; ${failed.length} failing`)
    console.log('═'.repeat(72))

    for (const c of checks) {
      const badge = c.failed ? 'FAIL' : 'PASS'
      console.log('')
      console.log(`[${badge}] ${c.name}  (${c.rowCount} row${c.rowCount === 1 ? '' : 's'})`)
      console.log(`       ${c.description}`)
      if (c.failed) {
        console.log('       Sample rows:')
        for (const row of c.sampleRows) {
          console.log('         ' + JSON.stringify(row))
        }
        if (c.rowCount > c.sampleRows.length) {
          console.log(`         ... (${c.rowCount - c.sampleRows.length} more not shown)`)
        }
        if (c.cleanupSql) {
          console.log('       Suggested cleanup:')
          for (const line of c.cleanupSql.split('\n')) {
            console.log('         ' + line)
          }
        }
      }
    }

    console.log('')
    console.log('═'.repeat(72))
    if (failed.length === 0) {
      console.log('  STATUS: CLEAR TO MIGRATE.')
      console.log('  All fail-closed guards satisfied. 027 and 028 may be applied.')
    } else {
      console.log(`  STATUS: BLOCKED. ${failed.length} issue(s) must be resolved before 027/028 can run.`)
      console.log('  Resolve each FAIL row above (respect the security notes on admin role),')
      console.log('  re-run this script until CLEAR TO MIGRATE, then apply the migrations.')
    }
    console.log('═'.repeat(72))
  }

  await closeDb().catch(() => {})
  process.exit(failed.length === 0 ? 0 : 1)
}

run().catch(async (err) => {
  console.error('Pre-migration check crashed:', err)
  await closeDb().catch(() => {})
  process.exit(3)
})
