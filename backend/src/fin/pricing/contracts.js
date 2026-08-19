/**
 * fin.contracts command service. Commercial life only — no ledger_transactions (C §6).
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  assertIfMatch, bumpHeader, claim, envelope, finish, iso, lockHeader,
  mapExclusion, nextKey, requireBackdatedApproval, withRetry,
} from './helpers.js'

export async function createContract(input) {
  const env = envelope(input)
  const tenantId = input.tenantId ?? input.tenant_id
  const billingAccountId = input.billingAccountId ?? input.billing_account_id
  const sellerLegalEntityId = input.sellerLegalEntityId ?? input.seller_legal_entity_id
  const contractNumber = input.contractNumber ?? input.contract_number
  const billingCurrency = input.billingCurrency ?? input.billing_currency
  const billingTimezone = input.billingTimezone ?? input.billing_timezone
  const startsAt = input.startsAt ?? input.starts_at ?? null
  const endsAt = input.endsAt ?? input.ends_at ?? null
  const key = env.idempotencyKey || `CONTRACT_CREATE:${sellerLegalEntityId}:${contractNumber}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreateContract', tenantId, billingAccountId, sellerLegalEntityId, contractNumber,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.contracts (
         id, environment, tenant_id, billing_account_id, seller_legal_entity_id,
         contract_number, status, starts_at, ends_at, billing_currency, billing_timezone,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$11,$12,$13)`,
      [
        id, env.environment, tenantId, billingAccountId, sellerLegalEntityId,
        contractNumber, startsAt, endsAt, billingCurrency, billingTimezone,
        env.now, env.actorType, env.actorId,
      ],
    )
    const header = (await client.query(`SELECT * FROM fin.contracts WHERE id = $1`, [id])).rows[0]
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'CONTRACT_CREATED',
      targetType: 'CONTRACT',
      targetId: id,
      afterState: { contractNumber, status: 'DRAFT' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.contract.status',
      dedupeKey: `contract:${id}:DRAFT`,
      payload: { id, status: 'DRAFT' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'CreateContract',
      id,
      version: Number(header.version),
    })
  })
}

export async function draftContractVersion(input) {
  const env = envelope(input)
  const contractId = input.contractId ?? input.contract_id
  const effectiveFrom = iso(input.effective_from ?? input.effectiveFrom)
  const effectiveTo = input.effective_to ?? input.effectiveTo ?? null
  const amendmentReason = input.amendment_reason ?? input.amendmentReason ?? null
  const components = input.components || []
  const key = env.idempotencyKey || nextKey(`CONTRACT_DRAFT:${contractId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DraftContractVersion', contractId, effectiveFrom, effectiveTo, components,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const header = await lockHeader(client, 'contracts', contractId)
    if (!header) {
      throw finError('FIN_CONTRACT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (['TERMINATED', 'EXPIRED'].includes(header.status)) {
      throw finError('CONTRACT_ALREADY_TERMINAL', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
    assertIfMatch(header, env.expectedVersion)

    const maxN = (await client.query(
      `SELECT COALESCE(MAX(version_n), 0) AS n FROM fin.contract_versions WHERE contract_id = $1`,
      [contractId],
    )).rows[0].n
    const versionId = randomUUID()
    const versionN = Number(maxN) + 1
    try {
      await client.query(
        `INSERT INTO fin.contract_versions (
           id, contract_id, environment, version_n, effective_from, effective_to,
           amendment_reason, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'DRAFT')`,
        [
          versionId, contractId, header.environment, versionN,
          effectiveFrom, effectiveTo, amendmentReason,
        ],
      )
    } catch (error) {
      mapExclusion(error, 'FIN_CONTRACT_VERSION_OVERLAP')
    }

    for (const component of components) {
      await client.query(
        `INSERT INTO fin.contract_components (
           id, contract_version_id, environment, component_type,
           price_id, meter_id, facility_id, config,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$9,$10,$11)`,
        [
          randomUUID(), versionId, header.environment,
          component.component_type ?? component.componentType,
          component.price_id ?? component.priceId ?? null,
          component.meter_id ?? component.meterId ?? null,
          component.facility_id ?? component.facilityId ?? null,
          JSON.stringify(component.config || {}),
          env.now, env.actorType, env.actorId,
        ],
      )
    }

    const bumped = await bumpHeader(client, {
      table: 'contracts',
      id: contractId,
      expectedVersion: header.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'CONTRACT_VERSION_DRAFTED',
      targetType: 'CONTRACT_VERSION',
      targetId: versionId,
      afterState: { contractId, versionN },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.contract.version',
      dedupeKey: `cv:${versionId}:DRAFT`,
      payload: { id: versionId, contractId, status: 'DRAFT' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'DraftContractVersion',
      id: versionId,
      contractId,
      version_n: versionN,
      version: Number(bumped.version),
    })
  })
}

async function supersedeActiveContractVersion(client, { contractId, successorFrom }) {
  const current = (await client.query(
    `SELECT * FROM fin.contract_versions
      WHERE contract_id = $1 AND status = 'ACTIVE'
      FOR UPDATE`,
    [contractId],
  )).rows[0]
  if (!current) return null
  if (new Date(successorFrom) <= new Date(current.effective_from)) {
    throw finError('FIN_CONTRACT_VERSION_OVERLAP', { category: CATEGORY.CONFLICT, httpStatus: 409 })
  }
  try {
    await client.query(
      `UPDATE fin.contract_versions
          SET status = 'SUPERSEDED', effective_to = $2
        WHERE id = $1 AND status = 'ACTIVE'`,
      [current.id, successorFrom],
    )
  } catch (error) {
    mapExclusion(error, 'FIN_CONTRACT_VERSION_OVERLAP')
  }
  return current
}

export async function activateContractVersion(input) {
  const env = envelope(input)
  const contractId = input.contractId ?? input.contract_id
  const contractVersionId = input.contractVersionId ?? input.contract_version_id
  const approvalRequestId = input.approvalRequestId ?? input.approval_request_id ?? null
  const key = env.idempotencyKey || nextKey(`CONTRACT_ACTIVATE:${contractVersionId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ActivateContractVersion', contractVersionId, approvalRequestId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const header = await lockHeader(client, 'contracts', contractId)
    if (!header) {
      throw finError('FIN_CONTRACT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (['TERMINATED', 'EXPIRED'].includes(header.status)) {
      throw finError('CONTRACT_ALREADY_TERMINAL', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
    assertIfMatch(header, env.expectedVersion)

    const version = (await client.query(
      `SELECT * FROM fin.contract_versions WHERE id = $1 AND contract_id = $2 FOR UPDATE`,
      [contractVersionId, contractId],
    )).rows[0]
    if (!version || version.status !== 'DRAFT') {
      throw finError('CONTRACT_VERSION_NOT_DRAFT', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }

    await requireBackdatedApproval(client, {
      approvalRequestId,
      now: env.now,
      effectiveFrom: version.effective_from,
    })
    await supersedeActiveContractVersion(client, {
      contractId,
      successorFrom: version.effective_from,
    })
    try {
      await client.query(
        `UPDATE fin.contract_versions
            SET status = 'ACTIVE', approved_by_approval_id = $2
          WHERE id = $1 AND status = 'DRAFT'`,
        [contractVersionId, approvalRequestId],
      )
    } catch (error) {
      mapExclusion(error, 'FIN_CONTRACT_VERSION_OVERLAP')
    }

    let contractStatus = header.status
    if (header.status === 'DRAFT') {
      await client.query(
        `UPDATE fin.contracts SET status = 'ACTIVE', updated_at = $2
          WHERE id = $1 AND version = $3 AND status = 'DRAFT'`,
        [contractId, env.now, header.version],
      )
      contractStatus = 'ACTIVE'
    } else {
      await bumpHeader(client, {
        table: 'contracts',
        id: contractId,
        expectedVersion: header.version,
        now: env.now,
        actorType: env.actorType,
        actorId: env.actorId,
      })
    }

    const active = (await client.query(
      `SELECT id FROM fin.contract_versions
        WHERE contract_id = $1 AND status = 'ACTIVE'`,
      [contractId],
    )).rows
    if (active.length !== 1) {
      throw finError('FIN_CONTRACT_NO_ACTIVE_VERSION', {
        category: CATEGORY.PRECONDITION,
        httpStatus: 409,
      })
    }

    const bumped = (await client.query(
      `SELECT version, status FROM fin.contracts WHERE id = $1`,
      [contractId],
    )).rows[0]
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'CONTRACT_VERSION_ACTIVATED',
      targetType: 'CONTRACT_VERSION',
      targetId: contractVersionId,
      afterState: { status: 'ACTIVE', contractStatus, approvalRequestId },
      reasonCode: env.reasonCode,
      approvalRequestId,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.contract.version',
      dedupeKey: `cv:${contractVersionId}:ACTIVE`,
      payload: { id: contractVersionId, contractId, status: 'ACTIVE' },
      now: env.now,
    })
    if (header.status === 'DRAFT') {
      await insertOutbox(client, {
        environment: env.environment,
        topic: 'fin.contract.status',
        dedupeKey: `contract:${contractId}:ACTIVE`,
        payload: { id: contractId, status: 'ACTIVE' },
        now: env.now,
      })
      await insertOutbox(client, {
        environment: env.environment,
        topic: 'notification.lifecycle',
        dedupeKey: `contract:${contractId}:ACTIVE:notify`,
        payload: { id: contractId, status: 'ACTIVE' },
        now: env.now,
      })
    }
    return finish(client, claimed, env, {
      command: 'ActivateContractVersion',
      id: contractVersionId,
      contractId,
      status: 'ACTIVE',
      contractStatus: bumped.status,
      version: Number(bumped.version),
    })
  })
}

async function transitionContract(input, { from, to, command, action, topicStatus }) {
  const env = envelope(input)
  const contractId = input.contractId ?? input.contract_id
  const key = env.idempotencyKey || nextKey(`${command}:${contractId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: command, contractId, to })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const header = await lockHeader(client, 'contracts', contractId)
    if (!header) {
      throw finError('FIN_CONTRACT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (!from.includes(header.status)) {
      throw finError('CONTRACT_ALREADY_TERMINAL', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
    assertIfMatch(header, env.expectedVersion)

    const updated = await client.query(
      `UPDATE fin.contracts
          SET status = $2, updated_at = $3,
              updated_by_actor_type = $4, updated_by_actor_id = $5
        WHERE id = $1 AND version = $6
        RETURNING *`,
      [contractId, to, env.now, env.actorType, env.actorId, header.version],
    )
    if (updated.rowCount === 0) {
      throw finError('PRECONDITION_FAILED', {
        category: CATEGORY.CONFLICT,
        httpStatus: 412,
        retryable: true,
        details: header,
      })
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action,
      targetType: 'CONTRACT',
      targetId: contractId,
      beforeState: { status: header.status },
      afterState: { status: to },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.contract.status',
      dedupeKey: `contract:${contractId}:${topicStatus}`,
      payload: { id: contractId, status: to },
      now: env.now,
    })
    if (to === 'SUSPENDED' || to === 'TERMINATED') {
      await insertOutbox(client, {
        environment: env.environment,
        topic: 'notification.lifecycle',
        dedupeKey: `contract:${contractId}:${topicStatus}:notify`,
        payload: { id: contractId, status: to },
        now: env.now,
      })
    }
    return finish(client, claimed, env, {
      command,
      id: contractId,
      status: to,
      version: Number(updated.rows[0].version),
    })
  })
}

export async function suspendContract(input) {
  return transitionContract(input, {
    from: ['ACTIVE'],
    to: 'SUSPENDED',
    command: 'SuspendContract',
    action: 'CONTRACT_SUSPENDED',
    topicStatus: 'SUSPENDED',
  })
}

export async function terminateContract(input) {
  return transitionContract(input, {
    from: ['DRAFT', 'ACTIVE', 'SUSPENDED'],
    to: 'TERMINATED',
    command: 'TerminateContract',
    action: 'CONTRACT_TERMINATED',
    topicStatus: 'TERMINATED',
  })
}
