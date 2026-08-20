/**
 * Auto top-up worker (spec §52 / B §4).
 * Advisory: pg_try_advisory_lock(FIN_AUTO_TOPUP, 0) — D §7.1 class 1010.
 * NEVER charges inline: createPurchaseIntent + submitPurchasePayment only
 * write outbox; PSP runs after commit (DL-094).
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { FIN_AUTO_TOPUP } from '../foundation/advisory-locks.js'
import { insertOutbox } from '../ledger/write.js'
import { createPurchaseIntent, submitPurchasePayment } from './purchase-intents.js'
import { iso } from './helpers.js'

function dayKey(now) {
  return iso(now).slice(0, 10)
}

function monthKey(now) {
  return iso(now).slice(0, 7)
}

async function remainingUnits(client, holderId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(remaining_units), 0)::text AS qty
       FROM fin.lots
      WHERE holder_id = $1 AND status = 'ACTIVE'`,
    [holderId],
  )
  return BigInt(rows[0].qty)
}

export async function runAutoTopupTick({
  pool, now, environment = 'LIVE', limit = 50,
} = {}) {
  const clock = iso(now || BusinessClock.now())
  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_AUTO_TOPUP, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, processed: 0, results: [], reason: 'AUTO_TOPUP_LOCK_HELD' }
    }

    try {
      const due = await lockClient.query(
        `SELECT p.*
           FROM fin.auto_topup_policies p
          WHERE p.environment = $1
            AND p.enabled = true
            AND p.auto_topup_suspended = false
            AND (p.cooldown_until IS NULL OR p.cooldown_until <= $2::timestamptz)
          ORDER BY p.billing_account_id ASC, p.id ASC
          LIMIT $3`,
        [environment, clock, limit],
      )

      const results = []
      let processed = 0
      for (const policy of due.rows) {
        try {
          const outcome = await transaction(async (client) => {
            const lockedPolicy = await client.query(
              `SELECT * FROM fin.auto_topup_policies WHERE id = $1 FOR UPDATE`,
              [policy.id],
            )
            const row = lockedPolicy.rows[0]
            if (!row || row.auto_topup_suspended || !row.enabled) {
              return { skipped: true, reason: 'not_eligible', policyId: policy.id }
            }
            if (row.cooldown_until && iso(row.cooldown_until) > clock) {
              return { skipped: true, reason: 'cooldown', policyId: policy.id }
            }
            if (row.last_intent_id) {
              const last = await client.query(
                `SELECT status FROM fin.purchase_intents WHERE id = $1`,
                [row.last_intent_id],
              )
              if (last.rows[0]?.status === 'PAYMENT_PENDING' || last.rows[0]?.status === 'CREATED') {
                return { skipped: true, reason: 'in_flight', policyId: policy.id }
              }
            }

            const remaining = await remainingUnits(client, row.holder_id)
            if (remaining > BigInt(row.threshold_units)) {
              return { skipped: true, reason: 'above_threshold', policyId: policy.id }
            }

            const today = dayKey(clock)
            const month = monthKey(clock)
            let dailyCount = Number(row.daily_count)
            let monthlyCount = Number(row.monthly_count)
            if (row.daily_period_key !== today) dailyCount = 0
            if (row.monthly_period_key !== month) monthlyCount = 0
            if (dailyCount >= Number(row.daily_cap) || monthlyCount >= Number(row.monthly_cap)) {
              return { skipped: true, reason: 'cap', policyId: policy.id }
            }

            const created = await createPurchaseIntent({
              environment: row.environment,
              tenantId: row.tenant_id,
              holderId: row.holder_id,
              billingAccountId: row.billing_account_id,
              productId: row.product_id,
              actorType: 'WORKER',
              actorId: null,
              reasonCode: 'AUTO_TOPUP',
              now: clock,
              provider: 'STRIPE',
              idempotencyKey: `PI:CREATE:AUTO:${row.id}:${today}:${dailyCount}`,
            })
            await submitPurchasePayment({
              intentId: created.id,
              provider: 'STRIPE',
              environment: row.environment,
              tenantId: row.tenant_id,
              actorType: 'WORKER',
              actorId: null,
              reasonCode: 'AUTO_TOPUP',
              now: clock,
              idempotencyKey: `PI:SUBMIT:${created.id}`,
            })

            const cooldownUntil = new Date(Date.parse(clock) + Number(row.cooldown_seconds) * 1000).toISOString()
            await client.query(
              `UPDATE fin.auto_topup_policies
                  SET last_intent_id = $2,
                      last_triggered_at = $3,
                      cooldown_until = $4,
                      daily_count = $5,
                      monthly_count = $6,
                      daily_period_key = $7,
                      monthly_period_key = $8,
                      streak_count = streak_count + 1,
                      failure_count = 0,
                      updated_at = $3
                WHERE id = $1`,
              [
                row.id, created.id, clock, cooldownUntil,
                dailyCount + 1, monthlyCount + 1, today, month,
              ],
            )
            return { skipped: false, policyId: row.id, intentId: created.id }
          })
          results.push(outcome)
          if (!outcome.skipped) processed += 1
        } catch (error) {
          const failed = await transaction(async (client) => {
            const lockedPolicy = await client.query(
              `SELECT * FROM fin.auto_topup_policies WHERE id = $1 FOR UPDATE`,
              [policy.id],
            )
            const row = lockedPolicy.rows[0]
            if (!row) return { skipped: true, reason: 'missing', policyId: policy.id }
            const nextCount = Number(row.failure_count) + 1
            const suspended = nextCount >= Number(row.failure_threshold)
            await client.query(
              `UPDATE fin.auto_topup_policies
                  SET failure_count = $2,
                      streak_count = 0,
                      auto_topup_suspended = $3,
                      updated_at = $4
                WHERE id = $1`,
              [row.id, nextCount, suspended, clock],
            )
            if (suspended) {
              await insertOutbox(client, {
                environment: row.environment,
                topic: 'notification.lifecycle',
                dedupeKey: `autotopup:${row.id}:suspended`,
                payload: { policyId: row.id, billingAccountId: row.billing_account_id },
                now: clock,
              })
            }
            return {
              skipped: false,
              failed: true,
              suspended,
              policyId: row.id,
              error: error.code || error.message,
            }
          })
          results.push(failed)
        }
      }
      return { skipped: false, processed, results }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_AUTO_TOPUP, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
