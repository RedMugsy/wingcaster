/**
 * PROVIDER_COST_ATTRIBUTED writer. Invoked when a vendor_statement is
 * FINALIZED (DL-155), one event per vendor_actual_cost row that can resolve
 * tenant + billing_account + legal_entity via rated_usage.
 *
 * Does not edit Stage 9 evaluatePostpaidCapture / evaluateConsumption.
 */
import { insertAccountingEvent } from './events.js'

export async function attributeProviderCostForStatement(client, {
  statement, now, actor,
}) {
  // Join billing_account via the rated_usage contract, not holder_id.
  // seedWorld (and production multi-currency tenants) attach several
  // billing_accounts to one holder; holder_id+environment fan-out made
  // one actual cost produce N rows, the second INSERT hit
  // uq_accounting_events_provider_cost (23505), and catching that without
  // a savepoint aborted the tx so the next loadActivePolicy saw 25P02
  // (DL-165).
  const { rows } = await client.query(
    `SELECT DISTINCT ON (a.id)
            a.id, a.amount_minor, a.currency,
            ru.tenant_id,
            c.billing_account_id,
            c.seller_legal_entity_id
       FROM fin.vendor_actual_costs a
       JOIN fin.vendor_statement_lines l ON l.id = a.vendor_statement_line_id
       LEFT JOIN fin.rated_usage ru ON ru.id = a.rated_usage_id
       LEFT JOIN fin.contract_versions cv ON cv.id = ru.contract_version_id
       LEFT JOIN fin.contracts c ON c.id = cv.contract_id
      WHERE l.statement_id = $1
      ORDER BY a.id`,
    [statement.id],
  )

  const inserted = []
  for (const row of rows) {
    if (!row.tenant_id || !row.billing_account_id || !row.seller_legal_entity_id) continue
    const existing = await client.query(
      `SELECT id FROM fin.accounting_events
        WHERE environment = $1
          AND source_type = 'VENDOR_ACTUAL_COST'
          AND source_id = $2
          AND event_kind = 'PROVIDER_COST_ATTRIBUTED'`,
      [statement.environment, row.id],
    )
    if (existing.rowCount) continue
    inserted.push(await insertAccountingEvent(client, {
      environment: statement.environment,
      tenantId: row.tenant_id,
      billingAccountId: row.billing_account_id,
      legalEntityId: row.seller_legal_entity_id,
      eventKind: 'PROVIDER_COST_ATTRIBUTED',
      amountMinor: row.amount_minor,
      currency: row.currency,
      sourceType: 'VENDOR_ACTUAL_COST',
      sourceId: row.id,
      now,
      eventAt: now,
      actor,
      memo: `vendor_statement:${statement.id}`,
    }))
  }
  return inserted
}
