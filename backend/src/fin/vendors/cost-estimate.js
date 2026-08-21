/**
 * Same-tx vendor cost estimate writer. Silent skip when the meter has no
 * vendor mapping (DL-153). Re-estimation SUPERSEDES the prior ACTIVE row.
 */
import { randomUUID } from 'node:crypto'
import { asMinor, iso } from './helpers.js'

function rateForProduct(rates, productCode) {
  if (!rates || typeof rates !== 'object') return null
  const row = rates[productCode]
  if (!row || row.unit_cost_minor == null) return null
  return {
    unitCostMinor: asMinor(row.unit_cost_minor),
    currency: row.currency,
  }
}

export async function resolveVendorRate(client, {
  vendorId, productCode, at,
}) {
  const { rows } = await client.query(
    `SELECT vrv.*
       FROM fin.vendor_rate_versions vrv
       JOIN fin.vendor_rate_cards vrc ON vrc.id = vrv.rate_card_id
      WHERE vrc.vendor_id = $1
        AND vrv.status IN ('ACTIVE', 'DEPRECATED')
        AND vrv.effective_from <= $2::timestamptz
        AND (vrv.effective_to IS NULL OR vrv.effective_to > $2::timestamptz)
      ORDER BY vrv.effective_from DESC, vrv.version_n DESC
      LIMIT 1`,
    [vendorId, at],
  )
  const version = rows[0]
  if (!version) return null
  const rate = rateForProduct(version.rates, productCode)
  if (!rate) return null
  return { version, ...rate }
}

export async function maybeWriteVendorCostEstimate(client, {
  ratedUsageId,
  meterId,
  quantityUnits,
  occurredAt,
  environment,
  now,
  actorType,
  actorId,
}) {
  if (!meterId || !ratedUsageId) return null
  const map = (await client.query(
    `SELECT * FROM fin.meter_vendor_map
      WHERE environment = $1 AND meter_id = $2`,
    [environment, meterId],
  )).rows[0]
  if (!map) return null

  const at = iso(occurredAt || now)
  const resolved = await resolveVendorRate(client, {
    vendorId: map.vendor_id,
    productCode: map.vendor_product_code,
    at,
  })
  if (!resolved) return null

  const qty = asMinor(quantityUnits)
  const amount = qty * resolved.unitCostMinor
  const clock = iso(now)

  const prior = (await client.query(
    `SELECT id FROM fin.vendor_cost_estimates
      WHERE rated_usage_id = $1 AND status = 'ACTIVE'
      FOR UPDATE`,
    [ratedUsageId],
  )).rows[0]
  if (prior) {
    await client.query(
      `UPDATE fin.vendor_cost_estimates
          SET status = 'SUPERSEDED', updated_at = $2,
              updated_by_actor_type = $3, updated_by_actor_id = $4
        WHERE id = $1 AND status = 'ACTIVE'`,
      [prior.id, clock, actorType || 'SYSTEM', actorId || null],
    )
  }

  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.vendor_cost_estimates (
       id, rated_usage_id, vendor_id, vendor_product_code, vendor_rate_version_id,
       environment, quantity_units, unit_cost_minor, amount_minor, currency, status,
       created_at, created_by_actor_type, created_by_actor_id,
       updated_at, updated_by_actor_type, updated_by_actor_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12,$13,$11,$12,$13
     )`,
    [
      id, ratedUsageId, map.vendor_id, map.vendor_product_code, resolved.version.id,
      environment, qty.toString(), resolved.unitCostMinor.toString(), amount.toString(),
      resolved.currency, clock, actorType || 'SYSTEM', actorId || null,
    ],
  )
  return { id, amountMinor: amount.toString(), supersededId: prior?.id || null }
}
