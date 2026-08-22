/**
 * Stage 13b correction writer (DL-182 / DL-185).
 * Idempotent on (source, source_row_id, correction_kind).
 */
import { randomUUID } from 'node:crypto'
import { BusinessClock } from '../../clock.js'

export async function recordCorrection(client, {
  environment = 'LIVE',
  source,
  sourceRowId,
  finRowId = null,
  correctionKind,
  reason = null,
  legacyPayload = {},
  correctedPayload = null,
  now = null,
} = {}) {
  const id = randomUUID()
  const createdAt = now || BusinessClock.now()
  await client.query(
    `INSERT INTO fin.cutover_backfill_corrections (
       id, environment, source, source_row_id, fin_row_id,
       correction_kind, reason, legacy_payload, corrected_payload, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       $6,$7,$8::jsonb,$9::jsonb,$10
     )
     ON CONFLICT (source, source_row_id, correction_kind) DO NOTHING`,
    [
      id,
      environment === 'TEST' ? 'TEST' : 'LIVE',
      source,
      String(sourceRowId),
      finRowId,
      correctionKind,
      reason,
      JSON.stringify(legacyPayload || {}),
      correctedPayload == null ? null : JSON.stringify(correctedPayload),
      createdAt,
    ],
  )
  return id
}
