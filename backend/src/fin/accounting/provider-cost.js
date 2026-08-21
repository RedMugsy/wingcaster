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
  const { rows } = await client.query(
    `SELECT a.*, ru.tenant_id, ru.metered_usage_id, mu.holder_id, ba.id AS billing_account_id,
            ba.seller_legal_entity_id
       FROM fin.vendor_actual_costs a
       JOIN fin.vendor_statement_lines l ON l.id = a.vendor_statement_line_id
       LEFT JOIN fin.rated_usage ru ON ru.id = a.rated_usage_id
       LEFT JOIN fin.metered_usage mu ON mu.id = ru.metered_usage_id
       LEFT JOIN fin.billing_accounts ba
         ON ba.holder_id = mu.holder_id AND ba.environment = a.environment
      WHERE l.statement_id = $1`,
    [statement.id],
  )

  const inserted = []
  for (const row of rows) {
    if (!row.tenant_id || !row.billing_account_id || !row.seller_legal_entity_id) continue
    try {
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
    } catch (error) {
      if (error?.code === '23505') continue
      throw error
    }
  }
  return inserted
}
