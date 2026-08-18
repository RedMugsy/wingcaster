import { randomUUID } from 'node:crypto'

export async function loadBook(client, bookId) {
  const { rows } = await client.query(
    `SELECT b.*, t.environment AS tenant_environment
       FROM fin.ledger_books b
       JOIN fin.tenants t ON t.id = b.tenant_id
      WHERE b.id = $1`,
    [bookId],
  )
  return rows[0] || null
}

export async function loadAccounts(client, bookId) {
  const { rows } = await client.query(
    `SELECT id, account_type FROM fin.ledger_accounts WHERE book_id = $1`,
    [bookId],
  )
  return Object.fromEntries(rows.map((r) => [r.account_type, r.id]))
}

export async function insertLedgerTx(client, {
  environment, bookId, pairId = null, fxRateSnapshotId = null, shape,
  economicSourceType, economicSourceId, actorType, actorId, reasonCode,
  idempotencyKeyId, now,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.ledger_transactions (
       id, environment, book_id, pair_id, fx_rate_snapshot_id, shape,
       economic_source_type, economic_source_id, actor_type, actor_id,
       reason_code, idempotency_key_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, environment, bookId, pairId, fxRateSnapshotId, shape,
      economicSourceType, economicSourceId, actorType, actorId,
      reasonCode, idempotencyKeyId, now,
    ],
  )
  return id
}

export async function insertPostingPair(client, {
  environment, transactionId, bookId, accounts, debitType, creditType,
  units, debitLotId = null, creditLotId = null, fxRateSnapshotId = null, now,
}) {
  const debitId = randomUUID()
  const creditId = randomUUID()
  await client.query(
    `INSERT INTO fin.ledger_postings (
       id, environment, transaction_id, book_id, account_id, amount_units,
       fx_rate_snapshot_id, lot_id, created_at
     ) VALUES
       ($1,$3,$4,$5,$6,$8,$10,$11,$13),
       ($2,$3,$4,$5,$7,$9,$10,$12,$13)`,
    [
      debitId, creditId,
      environment, transactionId, bookId,
      accounts[debitType], accounts[creditType],
      -units, units,
      fxRateSnapshotId, debitLotId, creditLotId, now,
    ],
  )
  return { debitId, creditId }
}

export async function insertLot(client, fields) {
  const id = fields.id || randomUUID()
  await client.query(
    `INSERT INTO fin.lots (
       id, environment, tenant_id, book_id, billing_account_id, holder_id,
       source_kind, granted_units, remaining_units, consideration_minor,
       currency, draw_priority, status, purchase_intent_id, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
    [
      id, fields.environment, fields.tenantId, fields.bookId, fields.billingAccountId,
      fields.holderId, fields.sourceKind, fields.grantedUnits, fields.remainingUnits,
      fields.considerationMinor, fields.currency, fields.drawPriority ?? 10,
      fields.status || 'ACTIVE', fields.purchaseIntentId || null, fields.now,
    ],
  )
  return id
}

export async function insertAllocation(client, {
  environment, lotId, postingId, units, holdId = null, now,
}) {
  await client.query(
    `INSERT INTO fin.lot_allocations (
       id, environment, lot_id, posting_id, hold_id, units, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), environment, lotId, postingId, holdId, units, now],
  )
}

export async function insertAudit(client, {
  environment, actorType, actorId, actorEmail, action, targetType, targetId,
  beforeState = null, afterState = null, reasonCode, approvalRequestId = null,
  requestId = null, now,
}) {
  await client.query(
    `INSERT INTO fin.financial_audit_events (
       id, environment, actor_type, actor_id, actor_email_snapshot, action,
       target_type, target_id, before_state, after_state, reason_code,
       approval_request_id, request_id, prev_hash, row_hash, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,
       repeat('0',64), repeat('0',64), $14
     )`,
    [
      randomUUID(), environment, actorType, actorId, actorEmail, action,
      targetType, targetId,
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null,
      reasonCode, approvalRequestId, requestId, now,
    ],
  )
}

export async function insertOutbox(client, {
  environment, topic, dedupeKey, payload, now,
}) {
  await client.query(
    `INSERT INTO fin.outbox_events (
       id, environment, topic, dedupe_key, payload, status, attempts,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5::jsonb,'PENDING',0,$6,$6)`
    [randomUUID(), environment, topic, dedupeKey, JSON.stringify(payload), now],
  )
}

export async function insertAuthAttempt(client, {
  environment, holderId, result, denialCode = null, holdId = null, now,
}) {
  await client.query(
    `INSERT INTO fin.authorization_attempts (
       id, environment, holder_id, result, denial_code, hold_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), environment, holderId, result, denialCode, holdId, now],
  )
}
