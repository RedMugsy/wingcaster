/**
 * Real-Postgres integration test for the platform-templates service.
 *
 * Proves the storage layer end-to-end:
 *   * migration 043 creates the tables and constraints
 *   * create/update round-trips through the DAL
 *   * every mutation appends a version row
 *   * required-variable enforcement blocks bad writes
 *   * unique (code, language, territory_id) is enforced for both the
 *     scoped and global cases
 *   * seed protection blocks deletion but permits deactivation
 *   * revert restores prior content and bumps version
 *   * resolver returns the best match with fallback
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

const OTP_TEMPLATE = {
  code: 'signup_otp',
  display_name: 'Signup OTP',
  description: 'Verification code sent at signup.',
  channel: 'email',
  category: 'auth',
  editor_mode: 'raw',
  subject: 'Your Wingcaster code: {{code}}',
  html_body: '<p>Hello {{name}}, your code is <b>{{code}}</b>.</p>',
  text_body: 'Hello {{name}}, your code is {{code}}.',
  required_variables: ['code', 'name'],
  optional_variables: ['support_email'],
}

skipIfNoPostgres()('platform-templates service (real Postgres)', () => {
  it('creates a template at version 1 with no history entries yet', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const created = await createTemplate(OTP_TEMPLATE, { id: 'admin-1' })

        expect(created.id).toBeTruthy()
        expect(created.code).toBe('signup_otp')
        expect(created.version).toBe(1)
        expect(created.subject).toContain('{{code}}')
        expect(created.is_active).toBe(true)
        expect(created.created_by).toBe('admin-1')

        // History holds only SUPERSEDED versions. The parent row IS the
        // canonical version-1 state, so at create-time history is empty.
        // Writing v1 here would collide with the first update's archive
        // (which also copies v1 into history) and violate the
        // (template_id, version) UNIQUE.
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
        // Override subject too — the base template's subject contains
        // {{code}}, and required-variable enforcement checks any part
        // (subject, html, text), so leaving the subject intact would
        // satisfy the requirement and mask the check.
        await expect(createTemplate({
          ...OTP_TEMPLATE,
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
        await expect(query(
          `INSERT INTO platform_message_templates
             (id, code, display_name, channel, category, editor_mode, html_body)
           VALUES ($1, 'x', 'X', 'email', 'auth', 'raw', '<p>hi</p>')`,
          [randomUUID()],
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
        // Two globals with the same (code, language) — second must fail.
        await createTemplate(OTP_TEMPLATE)
        await expect(createTemplate(OTP_TEMPLATE))
          .rejects.toMatchObject({ code: 'DUPLICATE_TEMPLATE' })

        // Territorial rows scoped to the same territory must also be
        // unique per (code, language, territory).
        const lb = await seedTerritory('LB')
        await createTemplate({ ...OTP_TEMPLATE, territory_id: lb })
        await expect(createTemplate({ ...OTP_TEMPLATE, territory_id: lb }))
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
        const lb = await seedTerritory('LB')
        await createTemplate(OTP_TEMPLATE)
        // Should succeed — different territory scope.
        await createTemplate({ ...OTP_TEMPLATE, territory_id: lb, display_name: 'Signup OTP (Lebanon)' })
        const rows = await listTemplates({ code: 'signup_otp' })
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
        const created = await createTemplate(OTP_TEMPLATE, { id: 'admin-1' })

        const updated = await updateTemplate(created.id, {
          subject: 'Verify {{code}} now',
          change_note: 'Sharpened subject line',
        }, { id: 'admin-2' })

        expect(updated.version).toBe(2)
        expect(updated.subject).toBe('Verify {{code}} now')
        expect(updated.updated_by).toBe('admin-2')

        const history = await getVersionHistory(created.id)
        // History holds only SUPERSEDED versions. The parent is now v2,
        // and v1's pre-change snapshot is the only archived row.
        expect(history.map((h) => h.version)).toEqual([1])
        expect(history[0].change_note).toBe('Sharpened subject line')
        // The archived row carries version-1 CONTENT, not version-1
        // metadata — the label is what the change note stamped when
        // v1 was superseded.
        expect(history[0].subject).toBe(OTP_TEMPLATE.subject)
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('rolls back an update that drops a required variable', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const created = await createTemplate(OTP_TEMPLATE)

        await expect(updateTemplate(created.id, {
          html_body: '<p>no variables here</p>',
          text_body: 'no variables here',
        })).rejects.toMatchObject({ code: 'TEMPLATE_MISSING_REQUIRED_VARIABLES' })

        // The failure must roll back — the row must still be version 1
        // with the original body, and history must not have a stale
        // half-written entry.
        const still = await getTemplate(created.id)
        expect(still.version).toBe(1)
        expect(still.html_body).toContain('{{code}}')

        // History was empty at v1 and should still be empty (no
        // superseded version to archive).
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
        const created = await createTemplate(OTP_TEMPLATE)

        await updateTemplate(created.id, {
          subject: 'v2 subject with {{code}}',
        })
        await updateTemplate(created.id, {
          subject: 'v3 subject with {{code}}',
        })

        const reverted = await revertTemplateToVersion(created.id, 1)
        expect(reverted.version).toBe(4)
        expect(reverted.subject).toBe(OTP_TEMPLATE.subject)

        const history = await getVersionHistory(created.id)
        // v1 -> v2: archives v1.
        // v2 -> v3: archives v2.
        // revert: archives v3 (as "reverted to version 1"), writes v4
        // with v1's content.
        // → 3 archived rows: v1, v2, v3.
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
        const seed = await createTemplate({ ...OTP_TEMPLATE, is_seed: true })

        await expect(deleteTemplate(seed.id))
          .rejects.toMatchObject({ code: 'CANNOT_DELETE_SEED_TEMPLATE' })

        // Deactivate instead.
        const deactivated = await updateTemplate(seed.id, { is_active: false })
        expect(deactivated.is_active).toBe(false)

        // Non-seed can be deleted.
        const editable = await createTemplate({
          ...OTP_TEMPLATE,
          language: 'ar',
          display_name: 'Signup OTP (Arabic)',
        })
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
        await createTemplate(OTP_TEMPLATE)
        const arRow = await createTemplate({ ...OTP_TEMPLATE, language: 'ar' })

        // Deactivate the Arabic one; default list must not include it.
        await updateTemplate(arRow.id, { is_active: false })

        const active = await listTemplates({ code: 'signup_otp' })
        expect(active.map((r) => r.language)).toEqual(['en'])

        const all = await listTemplates({ code: 'signup_otp', includeInactive: true })
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
        const lb = await seedTerritory('LB')
        await createTemplate(OTP_TEMPLATE) // global en
        await createTemplate({ ...OTP_TEMPLATE, language: 'ar', display_name: 'x' }) // global ar
        const target = await createTemplate({
          ...OTP_TEMPLATE, language: 'ar', territory_id: lb, display_name: 'y',
        })

        const resolved = await resolveTemplate({ code: 'signup_otp', language: 'ar', territoryId: lb })
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
        const lb = await seedTerritory('LB')
        const globalEn = await createTemplate(OTP_TEMPLATE)

        const resolved = await resolveTemplate({ code: 'signup_otp', language: 'ar', territoryId: lb })
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
        const lb = await seedTerritory('LB')
        const globalEn = await createTemplate(OTP_TEMPLATE)
        const scoped = await createTemplate({ ...OTP_TEMPLATE, territory_id: lb, display_name: 'x' })

        // Deactivating the territorial override must fall back to global.
        await updateTemplate(scoped.id, { is_active: false })

        const resolved = await resolveTemplate({ code: 'signup_otp', language: 'en', territoryId: lb })
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
        const resolved = await resolveTemplate({ code: 'not_seeded' })
        expect(resolved).toBeNull()
      } finally {
        await closeDb()
      }
    })
  }, 180_000)
})
