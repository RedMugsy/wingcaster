/**
 * Real-Postgres integration test for the platform-templates service.
 *
 * Proves the storage layer end-to-end:
 *   * migration 043 creates the tables and constraints
 *   * migration 044 seeds three defaults that coexist with test rows
 *   * create/update round-trips through the DAL
 *   * every mutation appends a version row
 *   * required-variable enforcement blocks bad writes
 *   * unique (code, language, territory_id) is enforced for both the
 *     scoped and global cases
 *   * seed protection blocks deletion but permits deactivation
 *   * revert restores prior content and bumps version
 *   * resolver returns the best match with fallback
 *
 * Every test uses a per-test template code (`test_tpl_N`) so it is
 * completely independent of what migration 044 seeds — using the same
 * `signup_otp` code as the seeded row would collide, and hiding the
 * seed under an aliased fixture would tie the tests to it.
 *
 * Runs only when TEST_DATABASE_URL is configured (skipIfNoPostgres).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplates,
  getTemplate,
  getVersionHistory,
  revertTemplateToVersion,
  resolveTemplate,
} from './index.js'

async function seedTerritory(code = 'LB') {
  const id = randomUUID()
  await query(
    'INSERT INTO public.territories (id, code, name, currency) VALUES ($1, $2, $3, $4)',
    [id, code, `Territory ${code}`, 'USD'],
  )
  return id
}

let templateSeq = 0
function makeTemplate(overrides = {}) {
  templateSeq += 1
  return {
    code: `test_tpl_${templateSeq}`,
    display_name: 'Test Template',
    description: 'Fixture template.',
    channel: 'email',
    category: 'auth',
    editor_mode: 'raw',
    subject: 'Your code: {{code}}',
    html_body: '<p>Hello {{name}}, your code is <b>{{code}}</b>.</p>',
    text_body: 'Hello {{name}}, your code is {{code}}.',
    required_variables: ['code', 'name'],
    optional_variables: ['support_email'],
    ...overrides,
  }
}

skipIfNoPostgres()('platform-templates service (real Postgres)', () => {
  it('creates a template at version 1 with no history entries yet', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const created = await createTemplate(tpl, { id: 'admin-1' })

        expect(created.id).toBeTruthy()
        expect(created.code).toBe(tpl.code)
        expect(created.version).toBe(1)
        expect(created.subject).toContain('{{code}}')
        expect(created.is_active).toBe(true)
        expect(created.created_by).toBe('admin-1')

        // History holds only SUPERSEDED versions. The parent row IS the
        // canonical version-1 state, so at create-time history is empty.
        const history = await getVersionHistory(created.id)
        expect(history).toEqual([])
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('rejects a create whose body does not reference every required variable', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        // Override every part — required-variable enforcement scans
        // subject, html and text together, so leaving one intact would
        // satisfy the requirement and mask the check.
        await expect(createTemplate({
          ...tpl,
          subject: 'Welcome to Wingcaster',
          html_body: '<p>Hello, welcome</p>',
          text_body: 'Hello, welcome',
          required_variables: ['code'],
        }, null)).rejects.toMatchObject({
          code: 'TEMPLATE_MISSING_REQUIRED_VARIABLES',
          missing: ['code'],
        })
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('rejects an email template without a subject at the DB level', async () => {
    // Application-level validation catches this too, but the CHECK
    // constraint means even a raw INSERT cannot bypass it.
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const uniqueCode = `nosub_${templateSeq++}`
        await expect(query(
          `INSERT INTO platform_message_templates
             (id, code, display_name, channel, category, editor_mode, html_body)
           VALUES ($1, $2, 'X', 'email', 'auth', 'raw', '<p>hi</p>')`,
          [randomUUID(), uniqueCode],
        )).rejects.toMatchObject({ code: '23514' })
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('enforces unique (code, language, territory) for both global and scoped rows', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        // Two globals with the same (code, language) — second must fail.
        await createTemplate(tpl)
        await expect(createTemplate(tpl))
          .rejects.toMatchObject({ code: 'DUPLICATE_TEMPLATE' })

        // Territorial rows scoped to the same territory must also be
        // unique per (code, language, territory).
        const lb = await seedTerritory('LB')
        await createTemplate({ ...tpl, territory_id: lb })
        await expect(createTemplate({ ...tpl, territory_id: lb }))
          .rejects.toMatchObject({ code: 'DUPLICATE_TEMPLATE' })
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('permits a global and a territorial row for the same (code, language)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const lb = await seedTerritory('LB')
        await createTemplate(tpl)
        // Should succeed — different territory scope.
        await createTemplate({ ...tpl, territory_id: lb, display_name: 'Test tpl (Lebanon)' })
        const rows = await listTemplates({ code: tpl.code })
        expect(rows).toHaveLength(2)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('bumps version and appends history on update', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const created = await createTemplate(tpl, { id: 'admin-1' })

        const updated = await updateTemplate(created.id, {
          subject: 'Verify {{code}} now',
          change_note: 'Sharpened subject line',
        }, { id: 'admin-2' })

        expect(updated.version).toBe(2)
        expect(updated.subject).toBe('Verify {{code}} now')
        expect(updated.updated_by).toBe('admin-2')

        const history = await getVersionHistory(created.id)
        // History holds only SUPERSEDED versions. The parent is now v2;
        // v1's pre-change snapshot is the only archived row.
        expect(history.map((h) => h.version)).toEqual([1])
        expect(history[0].change_note).toBe('Sharpened subject line')
        // The archived row carries version-1 content.
        expect(history[0].subject).toBe(tpl.subject)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('rolls back an update that drops a required variable', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const created = await createTemplate(tpl)

        await expect(updateTemplate(created.id, {
          subject: 'no vars',
          html_body: '<p>no variables here</p>',
          text_body: 'no variables here',
        })).rejects.toMatchObject({ code: 'TEMPLATE_MISSING_REQUIRED_VARIABLES' })

        // The failure must roll back — the row must still be version 1
        // with the original body, and history must not have a stale
        // half-written entry.
        const still = await getTemplate(created.id)
        expect(still.version).toBe(1)
        expect(still.html_body).toContain('{{code}}')

        const history = await getVersionHistory(created.id)
        expect(history).toEqual([])
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('reverts to a prior version, restoring content and bumping version', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const created = await createTemplate(tpl)

        await updateTemplate(created.id, { subject: 'v2 subject with {{code}}' })
        await updateTemplate(created.id, { subject: 'v3 subject with {{code}}' })

        const reverted = await revertTemplateToVersion(created.id, 1)
        expect(reverted.version).toBe(4)
        expect(reverted.subject).toBe(tpl.subject)

        const history = await getVersionHistory(created.id)
        // v1 → v2: archives v1.
        // v2 → v3: archives v2.
        // revert: archives v3, writes v4 with v1's content.
        expect(history.map((h) => h.version)).toEqual([3, 2, 1])
        expect(history[0].change_note).toMatch(/Reverted to version 1/i)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('refuses to delete a seed template but permits deactivation', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const seed = await createTemplate({ ...tpl, is_seed: true })

        await expect(deleteTemplate(seed.id))
          .rejects.toMatchObject({ code: 'CANNOT_DELETE_SEED_TEMPLATE' })

        // Deactivate instead.
        const deactivated = await updateTemplate(seed.id, { is_active: false })
        expect(deactivated.is_active).toBe(false)

        // Non-seed can be deleted (different template code so unique
        // constraint doesn't fire).
        const otherTpl = makeTemplate()
        const editable = await createTemplate(otherTpl)
        await deleteTemplate(editable.id)
        expect(await getTemplate(editable.id)).toBeNull()
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('lists templates with filtering and excludes inactive by default', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        await createTemplate(tpl)
        const arRow = await createTemplate({ ...tpl, language: 'ar' })

        // Deactivate the Arabic one; default list must not include it.
        await updateTemplate(arRow.id, { is_active: false })

        const active = await listTemplates({ code: tpl.code })
        expect(active.map((r) => r.language)).toEqual(['en'])

        const all = await listTemplates({ code: tpl.code, includeInactive: true })
        expect(all.map((r) => r.language).sort()).toEqual(['ar', 'en'])
      } finally {
        await closeDb()
      }
    })
  }, 180_000)
})

skipIfNoPostgres()('platform-templates resolver (real Postgres)', () => {
  it('picks the exact match when present', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const lb = await seedTerritory('LB')
        await createTemplate(tpl) // global en
        await createTemplate({ ...tpl, language: 'ar', display_name: 'x' }) // global ar
        const target = await createTemplate({
          ...tpl, language: 'ar', territory_id: lb, display_name: 'y',
        })

        const resolved = await resolveTemplate({ code: tpl.code, language: 'ar', territoryId: lb })
        expect(resolved.id).toBe(target.id)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('falls back to the global default when no territorial or language variant exists', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const lb = await seedTerritory('LB')
        const globalEn = await createTemplate(tpl)

        const resolved = await resolveTemplate({ code: tpl.code, language: 'ar', territoryId: lb })
        expect(resolved.id).toBe(globalEn.id)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('skips inactive rows in the fallback chain', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tpl = makeTemplate()
        const lb = await seedTerritory('LB')
        const globalEn = await createTemplate(tpl)
        const scoped = await createTemplate({ ...tpl, territory_id: lb, display_name: 'x' })

        // Deactivating the territorial override must fall back to global.
        await updateTemplate(scoped.id, { is_active: false })

        const resolved = await resolveTemplate({ code: tpl.code, language: 'en', territoryId: lb })
        expect(resolved.id).toBe(globalEn.id)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('returns null when nothing matches — caller decides policy', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const resolved = await resolveTemplate({ code: 'never_seeded_never_created' })
        expect(resolved).toBeNull()
      } finally {
        await closeDb()
      }
    })
  }, 180_000)
})

skipIfNoPostgres()('platform-templates — migration 044 seeds', () => {
  // The seeds are the whole point of this system existing. Any freshly
  // migrated database MUST have all three of these ready to use.
  const SEEDED_CODES = ['signup_otp', 'welcome', 'whatsapp_welcome']

  it('seeds all three defaults on migration, all marked is_seed=true and active', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const rows = await query(
          `SELECT code, channel, category, is_seed, is_active, language, territory_id
             FROM platform_message_templates
            WHERE code = ANY($1::text[])
            ORDER BY code`,
          [SEEDED_CODES],
        )
        expect(rows.map((r) => r.code).sort()).toEqual([...SEEDED_CODES].sort())
        for (const row of rows) {
          expect(row.is_seed).toBe(true)
          expect(row.is_active).toBe(true)
          expect(row.language).toBe('en')
          expect(row.territory_id).toBeNull()
        }
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('signup_otp seed references {{code}} — a broken seed would silently break signup', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const [seed] = await query(
          "SELECT subject, html_body, text_body, required_variables FROM platform_message_templates WHERE code = 'signup_otp'",
        )
        const allText = `${seed.subject} ${seed.html_body} ${seed.text_body}`
        expect(allText).toContain('{{code}}')
        expect(seed.required_variables).toContain('code')
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('resolver returns the seeded signup_otp with no territory / no language passed', async () => {
    // End-to-end: something the fallback layer in lib/otp.js relies on.
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const resolved = await resolveTemplate({ code: 'signup_otp' })
        expect(resolved).not.toBeNull()
        expect(resolved.code).toBe('signup_otp')
        expect(resolved.is_seed).toBe(true)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)
})
