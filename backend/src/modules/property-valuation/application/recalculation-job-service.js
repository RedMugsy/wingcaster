import { v4 as uuidv4 } from 'uuid'
import { Collections } from '../infrastructure/db.js'

const JOB_TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled'])

export function createRecalculationJobService({ dal, adapter, comparableService, analysisService, config, logger }) {
  async function enqueue(payload, requestedBy = null) {
    const scope = normalizeScope(payload)
    const existingJob = await dal.findOne(Collections.RECALCULATION_JOBS, (job) =>
      ['queued', 'running'].includes(job.status) &&
      job.scope_type === scope.scope_type &&
      job.scope_property_id === scope.scope_property_id &&
      job.scope_area_id === scope.scope_area_id &&
      job.scope_property_type === scope.scope_property_type
    )
    if (existingJob) return existingJob
    const properties = await resolveProperties(scope)
    if (scope.scope_type === 'property' && properties.length === 0) {
      throw validationError('Property not found')
    }
    if (scope.scope_type === 'area' && !(await adapter.getAreaById(scope.scope_area_id))) {
      throw validationError('Area not found')
    }

    const now = new Date().toISOString()
    const job = {
      id: uuidv4(),
      requested_by: requestedBy,
      ...scope,
      force_recompute: payload.force_recompute !== false,
      status: 'queued',
      total_items: properties.length,
      processed_items: 0,
      succeeded_items: 0,
      failed_items: 0,
      attempts: 0,
      max_attempts: Number(config.recalculationJobMaxAttempts || 3),
      created_at: now,
      updated_at: now,
      data: {},
    }
    await dal.insert(Collections.RECALCULATION_JOBS, job)
    for (const property of properties) {
      await dal.insert(Collections.RECALCULATION_JOB_ITEMS, {
        id: uuidv4(),
        job_id: job.id,
        property_id: property.id,
        status: 'queued',
        attempts: 0,
        max_attempts: job.max_attempts,
        created_at: now,
        updated_at: now,
        data: {},
      })
    }
    return job
  }

  async function resolveProperties(scope) {
    if (scope.scope_type === 'property') {
      const property = await adapter.getPropertyById(scope.scope_property_id)
      return property ? [property] : []
    }

    let properties = await adapter.getProperties({
      status: 'active',
      property_type: scope.scope_property_type || undefined,
    })
    if (scope.scope_type === 'area') {
      const matches = []
      for (const property of properties) {
        const area = await comparableService.resolveAreaForProperty(property)
        if (area?.id === scope.scope_area_id) matches.push(property)
      }
      properties = matches
    }
    return properties
  }

  async function list(filters = {}) {
    const rows = await dal.findAll(Collections.RECALCULATION_JOBS, (job) => {
      if (filters.status && job.status !== filters.status) return false
      if (filters.scope_type && job.scope_type !== filters.scope_type) return false
      return true
    })
    return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }

  async function get(jobId, { includeItems = false } = {}) {
    const job = await dal.findOne(Collections.RECALCULATION_JOBS, (candidate) => candidate.id === jobId)
    if (!job) return null
    if (!includeItems) return job
    const items = await dal.findAll(Collections.RECALCULATION_JOB_ITEMS, (item) => item.job_id === jobId)
    return { ...job, items: items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }
  }

  async function cancel(jobId) {
    const job = await get(jobId)
    if (!job) return null
    if (JOB_TERMINAL_STATUSES.has(job.status)) return job
    const now = new Date().toISOString()
    await dal.update(Collections.RECALCULATION_JOB_ITEMS, (item) => item.job_id === jobId && ['queued', 'failed'].includes(item.status), (item) => ({
      ...item,
      status: 'cancelled',
      finished_at: now,
      updated_at: now,
    }))
    await dal.update(Collections.RECALCULATION_JOBS, (candidate) => candidate.id === jobId, (candidate) => ({
      ...candidate,
      status: 'cancelled',
      finished_at: now,
      updated_at: now,
    }))
    return get(jobId, { includeItems: true })
  }

  async function retryFailed(jobId) {
    const job = await get(jobId)
    if (!job) return null
    const now = new Date().toISOString()
    await dal.update(Collections.RECALCULATION_JOB_ITEMS, (item) => item.job_id === jobId && item.status === 'failed', (item) => ({
      ...item,
      status: 'queued',
      attempts: 0,
      next_retry_at: null,
      last_error: null,
      started_at: null,
      finished_at: null,
      updated_at: now,
    }))
    await dal.update(Collections.RECALCULATION_JOBS, (candidate) => candidate.id === jobId, (candidate) => ({
      ...candidate,
      status: 'queued',
      processed_items: candidate.succeeded_items || 0,
      failed_items: 0,
      next_retry_at: null,
      last_error: null,
      finished_at: null,
      updated_at: now,
    }))
    return get(jobId, { includeItems: true })
  }

  async function processNextJob() {
    const claimed = await claimNextJob()
    if (!claimed) return null
    return processJob(claimed)
  }

  async function claimNextJob() {
    if (!dal.transaction) return null
    return dal.transaction(async (client) => {
      const result = await client.query(`
        SELECT *
        FROM market_pricing.recalculation_jobs
        WHERE status IN ('queued', 'running')
          AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `)
      const job = result.rows[0]
      if (!job) return null
      const now = new Date().toISOString()
      const leaseUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      await client.query(`
        UPDATE market_pricing.recalculation_jobs
        SET status = 'running', started_at = COALESCE(started_at, $2::timestamptz),
        attempts = attempts + 1, next_retry_at = $3::timestamptz, updated_at = $2::timestamptz
        WHERE id = $1
      `, [job.id, now, leaseUntil])
      return { ...job, status: 'running', started_at: job.started_at || now, next_retry_at: leaseUntil, attempts: Number(job.attempts || 0) + 1 }
    })
  }

  async function processJob(job) {
    const items = await dal.findAll(Collections.RECALCULATION_JOB_ITEMS, (item) => {
      if (item.job_id !== job.id) return false
      if (item.status === 'queued') return true
      if (item.status !== 'failed' || Number(item.attempts) >= Number(item.max_attempts)) return false
      return !item.next_retry_at || new Date(item.next_retry_at) <= new Date()
    })
    const batch = items.slice(0, Number(config.recalculationJobBatchSize || 25))

    for (const item of batch) {
      const currentJob = await get(job.id)
      if (!currentJob || currentJob.status === 'cancelled') break
      await processItem(job, item)
    }
    return finalizeJob(job.id)
  }

  async function processItem(job, item) {
    const now = new Date().toISOString()
    const attempts = Number(item.attempts || 0) + 1
    await dal.update(Collections.RECALCULATION_JOB_ITEMS, (candidate) => candidate.id === item.id, (candidate) => ({
      ...candidate,
      status: 'running',
      attempts,
      started_at: candidate.started_at || now,
      updated_at: now,
    }))
    try {
      await analysisService.getAnalysis(item.property_id, { force: job.force_recompute !== false })
      const finishedAt = new Date().toISOString()
      await dal.update(Collections.RECALCULATION_JOB_ITEMS, (candidate) => candidate.id === item.id, (candidate) => ({
        ...candidate,
        status: 'succeeded',
        last_error: null,
        next_retry_at: null,
        finished_at: finishedAt,
        updated_at: finishedAt,
      }))
    } catch (err) {
      const exhausted = attempts >= Number(item.max_attempts || job.max_attempts || 3)
      const failedAt = new Date().toISOString()
      const nextRetryAt = exhausted ? null : new Date(Date.now() + retryDelay(attempts)).toISOString()
      await dal.update(Collections.RECALCULATION_JOB_ITEMS, (candidate) => candidate.id === item.id, (candidate) => ({
        ...candidate,
        status: 'failed',
        last_error: err.message,
        next_retry_at: nextRetryAt,
        finished_at: exhausted ? failedAt : null,
        updated_at: failedAt,
      }))
      logger.warn({ err: err.message, jobId: job.id, propertyId: item.property_id, attempts }, 'Pricing recalculation job item failed')
    }
  }

  async function finalizeJob(jobId) {
    const job = await get(jobId)
    if (!job || job.status === 'cancelled') return job
    const items = await dal.findAll(Collections.RECALCULATION_JOB_ITEMS, (item) => item.job_id === jobId)
    const succeeded = items.filter((item) => item.status === 'succeeded').length
    const exhausted = items.filter((item) => item.status === 'failed' && Number(item.attempts) >= Number(item.max_attempts)).length
    const retryable = items.filter((item) => item.status === 'failed' && Number(item.attempts) < Number(item.max_attempts))
    const queued = items.filter((item) => item.status === 'queued').length
    const processed = succeeded + exhausted
    const finished = queued === 0 && retryable.length === 0
    const status = finished
      ? (exhausted > 0 ? (succeeded > 0 ? 'completed_with_errors' : 'failed') : 'completed')
      : 'queued'
    const nextRetryAt = retryable.map((item) => item.next_retry_at).filter(Boolean).sort()[0] || null
    const now = new Date().toISOString()
    await dal.update(Collections.RECALCULATION_JOBS, (candidate) => candidate.id === jobId, (candidate) => ({
      ...candidate,
      status,
      processed_items: processed,
      succeeded_items: succeeded,
      failed_items: exhausted,
      next_retry_at: nextRetryAt,
      last_error: exhausted > 0 ? `${exhausted} item${exhausted === 1 ? '' : 's'} exhausted retries` : null,
      finished_at: finished ? now : null,
      updated_at: now,
    }))
    return get(jobId, { includeItems: true })
  }

  async function invalidateProperty(propertyId, { enqueueJob = true } = {}) {
    const now = new Date().toISOString()
    await dal.update(Collections.PROPERTY_PRICE_ANALYSES, (analysis) => analysis.property_id === propertyId, (analysis) => ({
      ...analysis,
      expires_at: now,
      updated_at: now,
      data: { ...analysis.data, invalidated_at: now },
    }))
    if (!enqueueJob) return null
    return enqueue({ property_id: propertyId, force_recompute: true }, null)
  }

  async function invalidateAll({ enqueueJob = true, propertyType = null } = {}) {
    const now = new Date().toISOString()
    await dal.update(Collections.PROPERTY_PRICE_ANALYSES, () => true, (analysis) => ({
      ...analysis,
      expires_at: now,
      updated_at: now,
      data: { ...analysis.data, invalidated_at: now },
    }))
    if (!enqueueJob) return null
    return enqueue({ all: true, property_type: propertyType, force_recompute: true }, null)
  }

  async function invalidateForPropertyChange(property) {
    const area = await comparableService.resolveAreaForProperty(property)
    if (!area) return invalidateAll({ enqueueJob: true, propertyType: property.property_type || null })
    const scope = {
      scope_type: 'area',
      scope_property_id: null,
      scope_area_id: area.id,
      scope_property_type: property.property_type || null,
    }
    const affectedProperties = await resolveProperties(scope)
    const affectedIds = new Set(affectedProperties.map((item) => item.id))
    const now = new Date().toISOString()
    await dal.update(Collections.PROPERTY_PRICE_ANALYSES, (analysis) => affectedIds.has(analysis.property_id), (analysis) => ({
      ...analysis,
      expires_at: now,
      updated_at: now,
      data: { ...analysis.data, invalidated_at: now },
    }))
    return enqueue({ area_id: area.id, property_type: property.property_type, force_recompute: true }, null)
  }

  return {
    enqueue,
    list,
    get,
    cancel,
    retryFailed,
    processNextJob,
    invalidateProperty,
    invalidateAll,
    invalidateForPropertyChange,
  }
}

function normalizeScope(payload = {}) {
  if (payload.property_id) {
    return { scope_type: 'property', scope_property_id: payload.property_id, scope_area_id: null, scope_property_type: null }
  }
  if (payload.area_id) {
    return { scope_type: 'area', scope_property_id: null, scope_area_id: payload.area_id, scope_property_type: payload.property_type || null }
  }
  if (payload.all === true || payload.scope_type === 'all') {
    return { scope_type: 'all', scope_property_id: null, scope_area_id: null, scope_property_type: payload.property_type || null }
  }
  throw validationError('property_id, area_id, or all=true is required')
}

function validationError(message) {
  const error = new Error(message)
  error.status = 400
  error.code = 'VALIDATION_ERROR'
  return error
}

function retryDelay(attempt) {
  return Math.min(15 * 60 * 1000, 5000 * (2 ** Math.max(0, attempt - 1)))
}
