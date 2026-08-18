/**
 * usage_events LIST-partition ensure (D §7.4 / advisory class 1011).
 */
import { FIN_PARTITION_DDL } from '../foundation/advisory-locks.js'
import { CATEGORY, finError } from '../errors.js'

export async function ensureUsagePartition(client, residencyKey) {
  const { rows } = await client.query(
    'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
    [FIN_PARTITION_DDL, residencyKey],
  )
  if (!rows[0].ok) {
    throw finError('PARTITION_DDL_IN_PROGRESS', {
      category: CATEGORY.CONFLICT,
      retryable: true,
      httpStatus: 409,
    })
  }
  try {
    await client.query('SELECT fin.ensure_usage_events_partition($1)', [residencyKey])
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock($1, hashtext($2::text))',
      [FIN_PARTITION_DDL, residencyKey],
    )
  }
}
