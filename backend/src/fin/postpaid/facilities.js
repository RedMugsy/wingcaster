/**
 * Credit-facility header commands (B §18).
 * Each command: transaction(fn), claim first, per-facility xact lock,
 * audit + outbox in the same tx. No HTTP (I-14).
 */
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  asMinor, claim, envelope, finish, lockFacility, randomUUID, requireReason, withRetry,
} from './helpers.js'

const FACILITY_OPS = 'FACILITY_OPS'

function asActor(env) {
  return {
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
  }
}

async function loadFacility(client, facilityId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.credit_facilities WHERE id = $1`,
    [facilityId],
  )
  return rows[0] || null
}

async function consumeFacilityOps(client, env, approvalRequestId, facilityId) {
  if (!approvalRequestId) {
    throw finError('APPROVAL_NOT_APPROVED', { category: CATEGORY.APPROVAL })
  }
  const { rows } = await client.query(
    `SELECT * FROM fin.approval_requests WHERE id = $1 FOR UPDATE`,
    [approvalRequestId],
  )
  const row = rows[0]
  if (!row || row.action_kind !== FACILITY_OPS) {
    throw finError('APPROVAL_NOT_APPROVED', { category: CATEGORY.APPROVAL })
  }
  if (row.status !== 'APPROVED' && row.status !== 'EXECUTED') {
    throw finError('APPROVAL_NOT_APPROVED', {
      category: CATEGORY.APPROVAL,
      details: { status: row.status },
    })
  }
  if (row.status === 'APPROVED') {
    await client.query(
      `UPDATE fin.approval_requests
          SET status = 'EXECUTED',
              updated_at = $2,
              updated_by_actor_type = $3,
              updated_by_actor_id = $4
        WHERE id = $1`,
      [approvalRequestId, env.now, env.actorType, env.actorId],
    )
  }
  return row
}

async function writeStatus(client, env, facility, fromStatus) {
  await insertAudit(client, {
    environment: env.environment,
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
    action: 'FACILITY_STATUS',
    targetType: 'CREDIT_FACILITY',
    targetId: facility.id,
    beforeState: { status: fromStatus },
    afterState: { status: facility.status, version: String(facility.version) },
    reasonCode: env.reasonCode,
    now: env.now,
  })
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.facility.status',
    dedupeKey: `facility:${facility.id}:${facility.status}:${facility.version}`,
    payload: {
      facility_id: facility.id,
      from: fromStatus,
      to: facility.status,
      version: facility.version,
    },
    now: env.now,
  })
}

export async function createFacility(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const limitMinor = asMinor(input.limitMinor)
  if (limitMinor <= 0n) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'limit_minor_must_be_positive' },
    })
  }
  const key = env.idempotencyKey || `FACILITY:CREATE:${input.billingAccountId}:${input.currency}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreateFacility',
      billingAccountId: input.billingAccountId,
      currency: input.currency,
      limitMinor: limitMinor.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.credit_facilities (
         id, environment, tenant_id, billing_account_id, currency,
         limit_minor, net_terms_days, valid_from, valid_to, status, reason_code,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11,$12,$13,$11,$12,$13)`,
      [
        id, env.environment, env.tenantId, input.billingAccountId,
        input.currency, limitMinor.toString(), input.netTermsDays,
        input.validFrom || env.now, input.validTo || null, env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    const facility = await loadFacility(client, id)
    await writeStatus(client, env, facility, null)
    return finish(client, claimed, env, {
      facilityId: id,
      status: 'PENDING',
      version: facility.version,
    })
  })
}

async function transition(input, { to, cmdName, approval = true, actorOk = null }) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const facilityId = input.facilityId
  return withRetry(async (client) => {
    // Pre-load version outside the lock so each state-flip gets a fresh key (DL-114).
    const pre = await client.query(
      `SELECT version FROM fin.credit_facilities WHERE id = $1`,
      [facilityId],
    )
    const version = pre.rows[0]?.version ?? 0
    const key = env.idempotencyKey || `FACILITY:${cmdName}:${facilityId}:v${version}`
    const claimed = await claim(client, env, key, {
      cmd: `Facility${to}`, facilityId, to, cmdName, version,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    await lockFacility(client, facilityId)
    const facility = await loadFacility(client, facilityId)
    if (!facility) {
      throw finError('FACILITY_NOT_ACTIVE', { category: CATEGORY.PRECONDITION })
    }
    if (actorOk && !actorOk(env, facility)) {
      throw finError('FACILITY_NOT_ACTIVE', { category: CATEGORY.PRECONDITION })
    }
    // USER transitions require FACILITY_OPS (B §18). WORKER may suspend
    // without it (dunning). SYSTEM is the test/control-plane actor (DL-112).
    if (approval && env.actorType === 'USER') {
      await consumeFacilityOps(client, env, input.approvalRequestId, facilityId)
    }

    if (to === 'ACTIVE') {
      if (new Date(facility.valid_from) > new Date(env.now)) {
        throw finError('FACILITY_NOT_ACTIVE', {
          category: CATEGORY.PRECONDITION,
          details: { reason: 'valid_from_in_future' },
        })
      }
    }
    if (to === 'CLOSED') {
      const open = await client.query(
        `SELECT 1 FROM fin.facility_reservations
          WHERE facility_id = $1 AND status = 'OPEN' LIMIT 1`,
        [facilityId],
      )
      if (open.rowCount) {
        throw finError('FACILITY_OPEN_RESERVATIONS', { category: CATEGORY.PRECONDITION })
      }
    }

    const fromStatus = facility.status
    const allowed = {
      PENDING: ['ACTIVE', 'CLOSED'],
      ACTIVE: ['PAUSED', 'SUSPENDED', 'CLOSED'],
      PAUSED: ['ACTIVE', 'CLOSED'],
      SUSPENDED: ['ACTIVE', 'CLOSED'],
    }
    if (!(allowed[fromStatus] || []).includes(to)) {
      throw finError('FACILITY_NOT_ACTIVE', {
        category: CATEGORY.PRECONDITION,
        details: { from: fromStatus, to },
      })
    }
    await client.query(
      `UPDATE fin.credit_facilities
          SET status = $2,
              reason_code = $3,
              updated_at = $4,
              updated_by_actor_type = $5,
              updated_by_actor_id = $6
        WHERE id = $1`,
      [facilityId, to, env.reasonCode, env.now, env.actorType, env.actorId],
    )
    const next = await loadFacility(client, facilityId)
    await writeStatus(client, env, next, fromStatus)
    return finish(client, claimed, env, {
      facilityId,
      status: next.status,
      version: next.version,
    })
  })
}

export function activateFacility(input) {
  return transition(input, { to: 'ACTIVE', cmdName: 'ACTIVATE' })
}

export function pauseFacility(input) {
  return transition(input, { to: 'PAUSED', cmdName: 'PAUSE' })
}

export function resumeFacility(input) {
  return transition(input, { to: 'ACTIVE', cmdName: 'RESUME' })
}

export function suspendFacility(input) {
  const env = envelope(input)
  const needsOps = env.actorType === 'USER'
  return transition(input, { to: 'SUSPENDED', cmdName: 'SUSPEND', approval: needsOps })
}

export function closeFacility(input) {
  return transition(input, { to: 'CLOSED', cmdName: 'CLOSE' })
}

export async function amendFacilityLimit(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const limitMinor = asMinor(input.limitMinor)
  if (limitMinor <= 0n) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  const facilityId = input.facilityId
  const key = env.idempotencyKey || `FACILITY:LIMIT:${facilityId}:${limitMinor}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'AmendFacilityLimit', facilityId, limitMinor: limitMinor.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockFacility(client, facilityId)
    await consumeFacilityOps(client, env, input.approvalRequestId, facilityId)
    const facility = await loadFacility(client, facilityId)
    if (!facility || !['ACTIVE', 'PAUSED'].includes(facility.status)) {
      throw finError('FACILITY_NOT_ACTIVE', { category: CATEGORY.PRECONDITION })
    }
    await client.query(
      `UPDATE fin.credit_facilities
          SET limit_minor = $2, reason_code = $3, updated_at = $4,
              updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE id = $1`,
      [facilityId, limitMinor.toString(), env.reasonCode, env.now, env.actorType, env.actorId],
    )
    const next = await loadFacility(client, facilityId)
    await insertAudit(client, {
      environment: env.environment,
      ...asActor(env),
      action: 'FACILITY_LIMIT_AMENDED',
      targetType: 'CREDIT_FACILITY',
      targetId: facilityId,
      beforeState: { limit_minor: facility.limit_minor },
      afterState: { limit_minor: next.limit_minor },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    return finish(client, claimed, env, {
      facilityId,
      status: next.status,
      limitMinor: next.limit_minor,
      version: next.version,
    })
  })
}

export { loadFacility }
