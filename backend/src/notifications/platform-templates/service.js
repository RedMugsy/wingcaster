/**
 * Platform message template service — create, update, list, revert.
 *
 * Every mutation writes a row to platform_message_template_versions so an
 * admin who broke a template at 2am can revert in one click. `version` on
 * the parent row is the CURRENT version number; every update copies the
 * pre-change state into a version row and bumps.
 *
 * Business rules:
 *   * Required variables are enforced on every write. A template that
 *     does not reference every required variable is rejected up-front.
 *   * `is_seed=true` rows cannot be deleted — they always fall back to
 *     something rather than 404ing an OTP send. Admins deactivate
 *     instead, which the resolver treats as absent.
 *   * `code` is immutable after create; changing it would silently
 *     orphan every send site that refers to the old code.
 */

import { randomUUID } from 'node:crypto'
import { insert, query, transaction } from '../../db.js'
import { assertRequiredVariablesPresent } from './variables.js'

const CHANNELS = new Set(['email', 'whatsapp', 'sms'])
const EDITOR_MODES = new Set(['unlayer', 'mjml', 'raw'])
const CATEGORIES = new Set(['auth', 'onboarding', 'billing', 'notification', 'marketing'])

function assertValidChannel(channel) {
  if (!CHANNELS.has(channel)) {
    const err = new Error(`Unknown channel '${channel}'. Expected one of: ${[...CHANNELS].join(', ')}`)
    err.code = 'INVALID_CHANNEL'
    throw err
  }
}

function assertValidEditorMode(mode) {
  if (!EDITOR_MODES.has(mode)) {
    const err = new Error(`Unknown editor_mode '${mode}'. Expected one of: ${[...EDITOR_MODES].join(', ')}`)
    err.code = 'INVALID_EDITOR_MODE'
    throw err
  }
}

function assertValidCategory(category) {
  if (!CATEGORIES.has(category)) {
    const err = new Error(`Unknown category '${category}'. Expected one of: ${[...CATEGORIES].join(', ')}`)
    err.code = 'INVALID_CATEGORY'
    throw err
  }
}

function assertBodyPresent(channel, { subject, html_body, text_body }) {
  if (channel === 'email') {
    if (!subject || !subject.trim()) {
      const err = new Error('Email templates require a subject')
      err.code = 'MISSING_SUBJECT'
      throw err
    }
    if (!html_body?.trim() && !text_body?.trim()) {
      const err = new Error('Email templates require html_body or text_body')
      err.code = 'MISSING_BODY'
      throw err
    }
  } else {
    if (!text_body?.trim()) {
      const err = new Error(`${channel} templates require text_body`)
      err.code = 'MISSING_BODY'
      throw err
    }
  }
}

function normaliseArrayField(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return [value].filter(Boolean)
  return []
}

/**
 * Create a new template row.
 *
 * @param {object} input
 * @param {object} [actor] - { id } of the acting platform admin, for audit
 */
export async function createTemplate(input, actor = null) {
  if (!input?.code) throw Object.assign(new Error('code is required'), { code: 'MISSING_CODE' })
  if (!input?.display_name) throw Object.assign(new Error('display_name is required'), { code: 'MISSING_DISPLAY_NAME' })
  assertValidChannel(input.channel)
  assertValidCategory(input.category)
  const editorMode = input.editor_mode || 'unlayer'
  assertValidEditorMode(editorMode)

  const requiredVariables = normaliseArrayField(input.required_variables)
  const optionalVariables = normaliseArrayField(input.optional_variables)

  assertBodyPresent(input.channel, input)
  assertRequiredVariablesPresent(
    { subject: input.subject, html_body: input.html_body, text_body: input.text_body },
    requiredVariables,
  )

  const id = input.id || randomUUID()
  const now = new Date().toISOString()

  const row = await transaction(async (client) => {
    // Direct SQL to sidestep the DAL's default ON CONFLICT DO UPDATE
    // behaviour — a duplicate here should surface as an error, not
    // silently overwrite a different admin's row.
    const insertSql = `
      INSERT INTO platform_message_templates (
        id, code, display_name, description, channel, category,
        language, territory_id,
        subject, html_body, text_body, design_json, editor_mode,
        required_variables, optional_variables,
        is_active, is_seed, version,
        created_by, updated_by,
        created_at, updated_at, data
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11, $12::jsonb, $13,
        $14::jsonb, $15::jsonb,
        $16, $17, 1,
        $18, $18,
        $19, $19, '{}'::jsonb
      )
      RETURNING *
    `
    let result
    try {
      result = await client.query(insertSql, [
        id, input.code, input.display_name, input.description || null, input.channel, input.category,
        input.language || 'en', input.territory_id || null,
        input.subject || null, input.html_body || null, input.text_body || null,
        input.design_json ? JSON.stringify(input.design_json) : null,
        editorMode,
        JSON.stringify(requiredVariables), JSON.stringify(optionalVariables),
        input.is_active !== false, Boolean(input.is_seed),
        actor?.id || null,
        now,
      ])
    } catch (err) {
      if (err.code === '23505') {
        const dup = new Error(`A template already exists for (code=${input.code}, language=${input.language || 'en'}, territory=${input.territory_id || 'global'})`)
        dup.code = 'DUPLICATE_TEMPLATE'
        throw dup
      }
      throw err
    }
    const created = result.rows[0]
    await writeVersionRow(client, created, { changeNote: 'Initial version', actor })
    return created
  })

  return row
}

/**
 * Update an existing template. Every call bumps `version` and writes the
 * PREVIOUS state to the versions table, so revert is a straightforward
 * copy-in-a-transaction operation later.
 *
 * `code` cannot be changed — see the note in the module docstring.
 * `is_seed` is likewise immutable: an admin cannot promote or demote a
 * seed after the fact, since that would change the delete rules on rows
 * that already exist.
 */
export async function updateTemplate(id, patch, actor = null) {
  if (!id) throw Object.assign(new Error('id is required'), { code: 'MISSING_ID' })
  const changeNote = typeof patch?.change_note === 'string' ? patch.change_note : null

  return transaction(async (client) => {
    // Row lock — two concurrent edits from two admin sessions must not
    // both read version=1, both write version=2, both stash the same
    // version=1 history entry, and lose one edit.
    const { rows: existingRows } = await client.query(
      'SELECT * FROM platform_message_templates WHERE id = $1 FOR UPDATE',
      [id],
    )
    const existing = existingRows[0]
    if (!existing) {
      const err = new Error(`Template ${id} not found`)
      err.code = 'TEMPLATE_NOT_FOUND'
      throw err
    }

    // Compute the merged next state. Any field the patch does not name
    // is preserved as-is.
    const next = {
      subject: patch.subject !== undefined ? patch.subject : existing.subject,
      html_body: patch.html_body !== undefined ? patch.html_body : existing.html_body,
      text_body: patch.text_body !== undefined ? patch.text_body : existing.text_body,
      design_json: patch.design_json !== undefined ? patch.design_json : existing.design_json,
      editor_mode: patch.editor_mode || existing.editor_mode,
      required_variables: patch.required_variables !== undefined
        ? normaliseArrayField(patch.required_variables)
        : existing.required_variables,
      optional_variables: patch.optional_variables !== undefined
        ? normaliseArrayField(patch.optional_variables)
        : existing.optional_variables,
      is_active: patch.is_active !== undefined ? Boolean(patch.is_active) : existing.is_active,
      display_name: patch.display_name || existing.display_name,
      description: patch.description !== undefined ? patch.description : existing.description,
    }

    assertValidEditorMode(next.editor_mode)
    assertBodyPresent(existing.channel, next)
    assertRequiredVariablesPresent(
      { subject: next.subject, html_body: next.html_body, text_body: next.text_body },
      next.required_variables,
    )

    // Archive the CURRENT state before mutating in place. If the update
    // fails after this, the transaction rolls back and the version row
    // goes with it — so "one version row per successful update" holds.
    await writeVersionRow(client, existing, { changeNote, actor })

    const nextVersion = Number(existing.version) + 1
    const now = new Date().toISOString()

    const { rows: updatedRows } = await client.query(
      `UPDATE platform_message_templates
         SET display_name = $2,
             description = $3,
             subject = $4,
             html_body = $5,
             text_body = $6,
             design_json = $7::jsonb,
             editor_mode = $8,
             required_variables = $9::jsonb,
             optional_variables = $10::jsonb,
             is_active = $11,
             version = $12,
             updated_by = $13,
             updated_at = $14
       WHERE id = $1
       RETURNING *`,
      [
        id,
        next.display_name,
        next.description,
        next.subject,
        next.html_body,
        next.text_body,
        next.design_json != null ? JSON.stringify(next.design_json) : null,
        next.editor_mode,
        JSON.stringify(next.required_variables),
        JSON.stringify(next.optional_variables),
        next.is_active,
        nextVersion,
        actor?.id || null,
        now,
      ],
    )
    return updatedRows[0]
  })
}

/**
 * Revert to a previous version. Writes the current state as a new
 * version entry (so you can un-revert), then copies the target version's
 * content back into the parent row and bumps `version`.
 */
export async function revertTemplateToVersion(id, targetVersion, actor = null) {
  return transaction(async (client) => {
    const { rows: existingRows } = await client.query(
      'SELECT * FROM platform_message_templates WHERE id = $1 FOR UPDATE',
      [id],
    )
    const existing = existingRows[0]
    if (!existing) {
      const err = new Error(`Template ${id} not found`)
      err.code = 'TEMPLATE_NOT_FOUND'
      throw err
    }
    if (Number(existing.version) === Number(targetVersion)) {
      // Nothing to do; short-circuit rather than write a redundant
      // version row.
      return existing
    }
    const { rows: targetRows } = await client.query(
      'SELECT * FROM platform_message_template_versions WHERE template_id = $1 AND version = $2',
      [id, targetVersion],
    )
    const target = targetRows[0]
    if (!target) {
      const err = new Error(`Version ${targetVersion} of template ${id} not found`)
      err.code = 'VERSION_NOT_FOUND'
      throw err
    }

    await writeVersionRow(client, existing, {
      changeNote: `Reverted to version ${targetVersion}`,
      actor,
    })

    const nextVersion = Number(existing.version) + 1
    const now = new Date().toISOString()

    const { rows: updatedRows } = await client.query(
      `UPDATE platform_message_templates
         SET subject = $2,
             html_body = $3,
             text_body = $4,
             design_json = $5::jsonb,
             editor_mode = $6,
             required_variables = $7::jsonb,
             optional_variables = $8::jsonb,
             version = $9,
             updated_by = $10,
             updated_at = $11
       WHERE id = $1
       RETURNING *`,
      [
        id,
        target.subject,
        target.html_body,
        target.text_body,
        target.design_json != null ? JSON.stringify(target.design_json) : null,
        target.editor_mode,
        JSON.stringify(target.required_variables || []),
        JSON.stringify(target.optional_variables || []),
        nextVersion,
        actor?.id || null,
        now,
      ],
    )
    return updatedRows[0]
  })
}

/**
 * Delete a template. Seeds cannot be deleted — deactivate instead.
 */
export async function deleteTemplate(id) {
  if (!id) throw Object.assign(new Error('id is required'), { code: 'MISSING_ID' })
  const rows = await query('SELECT is_seed FROM platform_message_templates WHERE id = $1', [id])
  if (!rows.length) {
    const err = new Error(`Template ${id} not found`)
    err.code = 'TEMPLATE_NOT_FOUND'
    throw err
  }
  if (rows[0].is_seed) {
    const err = new Error('Seed templates cannot be deleted — deactivate instead')
    err.code = 'CANNOT_DELETE_SEED_TEMPLATE'
    throw err
  }
  await query('DELETE FROM platform_message_templates WHERE id = $1', [id])
  return { deleted: true }
}

/**
 * List templates. All parameters are optional; unspecified means "match
 * anything on that axis". The admin UI uses `code` filtering to build the
 * variant list per template.
 */
export async function listTemplates({ code, channel, category, language, territoryId, includeInactive = false } = {}) {
  const clauses = []
  const params = []
  const add = (sql, val) => { params.push(val); clauses.push(sql.replace('?', `$${params.length}`)) }
  if (code) add('code = ?', code)
  if (channel) add('channel = ?', channel)
  if (category) add('category = ?', category)
  if (language) add('language = ?', String(language).toLowerCase())
  if (territoryId !== undefined) {
    if (territoryId === null) clauses.push('territory_id IS NULL')
    else add('territory_id = ?', territoryId)
  }
  if (!includeInactive) clauses.push('is_active = true')
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return query(`SELECT * FROM platform_message_templates ${where} ORDER BY code, language, territory_id NULLS FIRST`, params)
}

export async function getTemplate(id) {
  const rows = await query('SELECT * FROM platform_message_templates WHERE id = $1', [id])
  return rows[0] || null
}

export async function getVersionHistory(id) {
  return query(
    'SELECT * FROM platform_message_template_versions WHERE template_id = $1 ORDER BY version DESC',
    [id],
  )
}

/** Internal: append a version row for `templateRow`'s current state. */
async function writeVersionRow(client, templateRow, { changeNote = null, actor = null } = {}) {
  await client.query(
    `INSERT INTO platform_message_template_versions (
      id, template_id, version,
      subject, html_body, text_body, design_json, editor_mode,
      required_variables, optional_variables,
      change_note, created_by, created_at, updated_at, data
    )
    VALUES (
      $1, $2, $3,
      $4, $5, $6, $7::jsonb, $8,
      $9::jsonb, $10::jsonb,
      $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}'::jsonb
    )`,
    [
      randomUUID(),
      templateRow.id,
      templateRow.version,
      templateRow.subject,
      templateRow.html_body,
      templateRow.text_body,
      templateRow.design_json != null ? JSON.stringify(templateRow.design_json) : null,
      templateRow.editor_mode,
      JSON.stringify(templateRow.required_variables || []),
      JSON.stringify(templateRow.optional_variables || []),
      changeNote,
      actor?.id || null,
    ],
  )
}

export const __testables = { assertBodyPresent, normaliseArrayField, writeVersionRow }
