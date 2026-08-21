/**
 * Stage 12 ops admin surface. Thin HTTP over existing Stage 1–10 commands.
 * Guards copy Stage 4 pricing routes (platform_admin + elevated + limiter + If-Match).
 * environment / now never come from req.body (DL-164 / DL-101).
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { requireElevated } from '../../auth.js'
import { getPool } from '../../persistence/postgres-adapter.js'
import { CATEGORY, FinError, finError } from '../errors.js'
import { requireIfMatch, sendPreconditionFailed, setETag } from '../middleware/if-match.js'
import { adminMutationLimiter } from '../../lib/admin-limiter.js'
import { actorFrom, commandBody, pick, resolveAdminContext, sessionEnvironment } from './context.js'
import { loadOverviewKpis } from './kpis.js'
import { deferredExceptionPayload, loadExceptions } from './exceptions.js'
import {
  getBillingPeriod, getInvoice, getReconRun, getTenant, listApprovals, listAudit, listConfiguration,
  listContracts, listDunningCases, listFacilities, listHolds, listInvoices,
  listLots, listPayments, listReconRuns, listTenants, simulatePrice, usageDrill,
} from './reads.js'
import {
  amendFacilityLimit, closeFacility, createFacility, pauseFacility,
  resumeFacility, suspendFacility,
} from '../postpaid/facilities.js'
import { runReconciliation } from '../reconciliation/runner.js'
import { advanceDunning } from '../dunning/steps.js'
import { cureDunning } from '../dunning/cases.js'
import { writeOffInvoice } from '../dunning/write-off-invoice.js'
import { advanceBillingPeriodClose } from '../billing/period-close.js'
import { reopenBillingPeriod } from '../billing/periods.js'
import { voidIssuedInvoice } from '../billing/invoice-issuer.js'
import { approveCreditNote, draftCreditNote, issueCreditNote } from '../billing/credit-note.js'
import { approveDebitNote, draftDebitNote, issueDebitNote } from '../billing/debit-note.js'
import { applyPayment, recordPayment, reversePayment } from '../billing/payment-allocation.js'
import { hardClosePeriod, reopenPeriod, softClosePeriod } from '../accounting/periods.js'
import { loadCutoverReadiness } from '../cutover/backfill/readiness.js'

let registerFinVendorAdminRoutes = null
const vendorRoutesPath = join(dirname(fileURLToPath(import.meta.url)), 'vendors', 'routes.js')
if (existsSync(vendorRoutesPath)) {
  ({ registerFinVendorAdminRoutes } = await import(pathToFileURL(vendorRoutesPath).href))
}

function requireExplicitPlatformAdmin(req, res, next) {
  if (req.user?.platform_role !== 'platform_admin') {
    return res.status(403).json({ error: 'Forbidden: platform admin required' })
  }
  next()
}

function adminCsp(_req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'self'")
  next()
}

function sendFinError(res, error) {
  if (error instanceof FinError && error.httpStatus === 412) {
    return sendPreconditionFailed(res, error.details || {})
  }
  if (error instanceof FinError) {
    return res.status(error.httpStatus).json(error.toJSON())
  }
  throw error
}

function notImplemented(res, dl, command) {
  return res.status(501).json({
    code: 'NOT_IMPLEMENTED',
    dl,
    command,
    error: `${command} is not implemented; ${dl}`,
  })
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res)
    } catch (error) {
      try { return sendFinError(res, error) } catch (err) { next(err) }
    }
  }
}

function input(req, extra = {}) {
  const body = commandBody(req)
  return {
    ...body,
    billingAccountId: pick(body, 'billingAccountId', 'billing_account_id'),
    billingPeriodId: pick(body, 'billingPeriodId', 'billing_period_id', 'periodId'),
    periodId: pick(body, 'periodId', 'period_id', 'billingPeriodId', 'billing_period_id'),
    facilityId: pick(body, 'facilityId', 'facility_id'),
    invoiceId: pick(body, 'invoiceId', 'invoice_id'),
    paymentId: pick(body, 'paymentId', 'payment_id'),
    caseId: pick(body, 'caseId', 'case_id'),
    noteId: pick(body, 'noteId', 'note_id'),
    approvalRequestId: pick(body, 'approvalRequestId', 'approval_request_id'),
    limitMinor: pick(body, 'limitMinor', 'limit_minor'),
    amountMinor: pick(body, 'amountMinor', 'amount_minor', 'amount'),
    netTermsDays: pick(body, 'netTermsDays', 'net_terms_days'),
    validFrom: pick(body, 'validFrom', 'valid_from'),
    ...extra,
    ...actorFrom(req),
  }
}

function registerVendorStub(app, readGuards) {
  app.get('/api/admin/fin/vendors', readGuards, (_req, res) => {
    res.status(200).json({
      vendors: [],
      stage11: false,
      message: 'Stage 11 not merged',
    })
  })
  app.get('/api/admin/fin/vendors/:id', readGuards, (_req, res) => {
    res.status(200).json({
      vendor: null,
      stage11: false,
      message: 'Stage 11 not merged',
    })
  })
}

export function registerFinOpsAdminRoutes(app, { authMiddleware, requirePlatformAdmin } = {}) {
  if (!authMiddleware) throw new Error('registerFinOpsAdminRoutes requires authMiddleware')
  if (!requirePlatformAdmin) throw new Error('registerFinOpsAdminRoutes requires requirePlatformAdmin')

  const readGuards = [authMiddleware, requirePlatformAdmin, resolveAdminContext, adminCsp]
  const writeGuards = [
    authMiddleware,
    requirePlatformAdmin,
    requireExplicitPlatformAdmin,
    requireElevated(),
    adminMutationLimiter,
    requireIfMatch,
    resolveAdminContext,
    adminCsp,
  ]

  app.get('/api/admin/fin/overview', readGuards, wrap(async (req, res) => {
    const payload = await loadOverviewKpis({
      environment: sessionEnvironment(req),
      now: req.fin.now,
    })
    return res.status(200).json(payload)
  }))

  app.get('/api/admin/fin/tenants', readGuards, wrap(async (req, res) => {
    const rows = await listTenants({ environment: sessionEnvironment(req) })
    return res.status(200).json({ tenants: rows })
  }))

  app.get('/api/admin/fin/tenants/:id', readGuards, wrap(async (req, res) => {
    const row = await getTenant({ environment: sessionEnvironment(req), id: req.params.id })
    if (!row) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(200).json(row)
  }))

  app.get('/api/admin/fin/usage', readGuards, wrap(async (req, res) => {
    const payload = await usageDrill({
      environment: sessionEnvironment(req),
      tenantId: req.query.tenant || req.query.tenant_id,
      holderId: req.query.holder || req.query.holder_id,
      billingAccountId: req.query.billing_account || req.query.billing_account_id,
      bookId: req.query.book || req.query.book_id,
      accountType: req.query.account_type,
    })
    return res.status(200).json(payload)
  }))

  app.get('/api/admin/fin/credits/lots', readGuards, wrap(async (req, res) => {
    const lots = await listLots({
      environment: sessionEnvironment(req),
      tenantId: req.query.tenant || req.query.tenant_id,
    })
    return res.status(200).json({ lots })
  }))

  app.get('/api/admin/fin/holds', readGuards, wrap(async (req, res) => {
    const holds = await listHolds({ environment: sessionEnvironment(req) })
    return res.status(200).json({ holds })
  }))

  app.get('/api/admin/fin/facilities', readGuards, wrap(async (req, res) => {
    const facilities = await listFacilities({ environment: sessionEnvironment(req) })
    return res.status(200).json({ facilities })
  }))

  app.get('/api/admin/fin/contracts', readGuards, wrap(async (req, res) => {
    const contracts = await listContracts({ environment: sessionEnvironment(req) })
    return res.status(200).json({ contracts })
  }))

  app.get('/api/admin/fin/pricing', readGuards, wrap(async (req, res) => {
    const simulated = await simulatePrice({
      model: req.query.model,
      billableUnits: req.query.billable_units || req.query.billableUnits,
      unitRateMinor: req.query.unit_rate_minor || req.query.unitRateMinor,
      packageSizeUnits: req.query.package_size_units,
    })
    return res.status(200).json({ simulator: simulated })
  }))

  app.get('/api/admin/fin/invoices', readGuards, wrap(async (req, res) => {
    const invoices = await listInvoices({ environment: sessionEnvironment(req) })
    return res.status(200).json({ invoices })
  }))

  app.get('/api/admin/fin/invoices/:id', readGuards, wrap(async (req, res) => {
    const invoice = await getInvoice({ environment: sessionEnvironment(req), id: req.params.id })
    if (!invoice) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(200).json(invoice)
  }))

  app.get('/api/admin/fin/payments', readGuards, wrap(async (req, res) => {
    const payments = await listPayments({ environment: sessionEnvironment(req) })
    return res.status(200).json({ payments })
  }))

  app.get('/api/admin/fin/reconciliation/runs', readGuards, wrap(async (req, res) => {
    const runs = await listReconRuns({ environment: sessionEnvironment(req) })
    return res.status(200).json({ runs })
  }))

  app.get('/api/admin/fin/reconciliation/runs/:id', readGuards, wrap(async (req, res) => {
    const run = await getReconRun({ environment: sessionEnvironment(req), id: req.params.id })
    if (!run) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(200).json(run)
  }))

  app.get('/api/admin/fin/exceptions', readGuards, wrap(async (req, res) => {
    const payload = await loadExceptions({ environment: sessionEnvironment(req) })
    return res.status(200).json(payload)
  }))

  app.get('/api/admin/fin/approvals', readGuards, wrap(async (req, res) => {
    const approvals = await listApprovals({ environment: sessionEnvironment(req) })
    return res.status(200).json({ approvals })
  }))

  app.get('/api/admin/fin/audit', readGuards, wrap(async (req, res) => {
    const events = await listAudit({ environment: sessionEnvironment(req) })
    return res.status(200).json({ events })
  }))

  app.get('/api/admin/fin/configuration', readGuards, wrap(async (req, res) => {
    const payload = await listConfiguration({ environment: sessionEnvironment(req) })
    return res.status(200).json(payload)
  }))

  app.get('/api/admin/fin/cutover/readiness', readGuards, wrap(async (req, res) => {
    const payload = await loadCutoverReadiness(getPool(), {
      environment: sessionEnvironment(req),
      now: req.fin.now,
    })
    return res.status(200).json(payload)
  }))

  app.get('/api/admin/fin/dunning/cases', readGuards, wrap(async (req, res) => {
    const cases = await listDunningCases({ environment: sessionEnvironment(req) })
    return res.status(200).json({ cases })
  }))

  if (registerFinVendorAdminRoutes) {
    registerFinVendorAdminRoutes(app, { authMiddleware, requirePlatformAdmin })
  } else {
    registerVendorStub(app, readGuards)
  }

  app.post('/api/admin/fin/facilities', writeGuards, wrap(async (req, res) => {
    const result = await createFacility(input(req))
    if (result.version != null) setETag(res, result.version)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/facilities/:id/pause', writeGuards, wrap(async (req, res) => {
    const result = await pauseFacility(input(req, { facilityId: req.params.id }))
    if (result.version != null) setETag(res, result.version)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/facilities/:id/resume', writeGuards, wrap(async (req, res) => {
    const result = await resumeFacility(input(req, { facilityId: req.params.id }))
    if (result.version != null) setETag(res, result.version)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/facilities/:id/suspend', writeGuards, wrap(async (req, res) => {
    const result = await suspendFacility(input(req, { facilityId: req.params.id }))
    if (result.version != null) setETag(res, result.version)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/facilities/:id/close', writeGuards, wrap(async (req, res) => {
    const result = await closeFacility(input(req, { facilityId: req.params.id }))
    if (result.version != null) setETag(res, result.version)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/facilities/:id/limit', writeGuards, wrap(async (req, res) => {
    const result = await amendFacilityLimit(input(req, { facilityId: req.params.id }))
    if (result.version != null) setETag(res, result.version)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/reconciliation/run', writeGuards, wrap(async (req, res) => {
    const result = await runReconciliation(getPool(), {
      environment: sessionEnvironment(req),
      scheduleKind: 'ON_DEMAND',
      now: req.fin.now,
    })
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/reconciliation/drift/:id/resolve', writeGuards, wrap(async (_req, res) => {
    return notImplemented(res, 'DL-165', 'resolveDrift')
  }))

  app.post('/api/admin/fin/approvals/:id/approve', writeGuards, wrap(async (_req, res) => {
    return notImplemented(res, 'DL-166', 'approveRequest')
  }))

  app.post('/api/admin/fin/approvals/:id/reject', writeGuards, wrap(async (_req, res) => {
    return notImplemented(res, 'DL-166', 'rejectRequest')
  }))

  app.post('/api/admin/fin/dunning/cases/:id/advance', writeGuards, wrap(async (req, res) => {
    const result = await advanceDunning(input(req, { caseId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/dunning/cases/:id/cure', writeGuards, wrap(async (req, res) => {
    const result = await cureDunning(input(req, { caseId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/dunning/cases/:id/write-off', writeGuards, wrap(async (req, res) => {
    const result = await writeOffInvoice(input(req, {
      caseId: req.params.id,
      invoiceId: pick(req.body, 'invoiceId', 'invoice_id'),
    }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/billing/periods/:id/close', writeGuards, wrap(async (req, res) => {
    const result = await advanceBillingPeriodClose(input(req, {
      billingPeriodId: req.params.id,
    }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/billing/periods/:id/reopen', writeGuards, wrap(async (req, res) => {
    const env = input(req, {
      billingPeriodId: req.params.id,
      periodId: req.params.id,
    })
    // DL-170: OPEN has no reopen transition. Route-level 409; Stage 10 files frozen.
    const period = await getBillingPeriod({
      environment: env.environment,
      id: req.params.id,
    })
    if (period?.status === 'OPEN') {
      throw finError('BILLING_PERIOD_ALREADY_OPEN', {
        category: CATEGORY.CONFLICT,
        httpStatus: 409,
        details: { dl: 'DL-170', status: 'OPEN' },
      })
    }
    const result = await reopenBillingPeriod(env)
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/invoices/:id/void', writeGuards, wrap(async (req, res) => {
    const result = await voidIssuedInvoice(input(req, { invoiceId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/invoices/:id/credit-note', writeGuards, wrap(async (req, res) => {
    const env = input(req, { invoiceId: req.params.id })
    const drafted = await draftCreditNote({
      ...env,
      amount: env.amountMinor,
      idempotencyKey: env.idempotencyKey ? `${env.idempotencyKey}:draft` : undefined,
    })
    const approved = await approveCreditNote({
      ...env,
      noteId: drafted.noteId,
      idempotencyKey: env.idempotencyKey ? `${env.idempotencyKey}:approve` : undefined,
    })
    const issued = await issueCreditNote({
      ...env,
      noteId: approved.noteId || drafted.noteId,
      idempotencyKey: env.idempotencyKey,
    })
    return res.status(200).json(issued)
  }))

  app.post('/api/admin/fin/invoices/:id/debit-note', writeGuards, wrap(async (req, res) => {
    const env = input(req, { invoiceId: req.params.id })
    const drafted = await draftDebitNote({
      ...env,
      amount: env.amountMinor,
      idempotencyKey: env.idempotencyKey ? `${env.idempotencyKey}:draft` : undefined,
    })
    const approved = await approveDebitNote({
      ...env,
      noteId: drafted.noteId,
      idempotencyKey: env.idempotencyKey ? `${env.idempotencyKey}:approve` : undefined,
    })
    const issued = await issueDebitNote({
      ...env,
      noteId: approved.noteId || drafted.noteId,
      idempotencyKey: env.idempotencyKey,
    })
    return res.status(200).json(issued)
  }))

  app.post('/api/admin/fin/payments', writeGuards, wrap(async (req, res) => {
    const result = await recordPayment(input(req))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/payments/:id/apply', writeGuards, wrap(async (req, res) => {
    const result = await applyPayment(input(req, { paymentId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/payments/:id/reverse', writeGuards, wrap(async (req, res) => {
    const result = await reversePayment(input(req, { paymentId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/accounting/periods/:id/soft-close', writeGuards, wrap(async (req, res) => {
    const result = await softClosePeriod(input(req, { periodId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/accounting/periods/:id/hard-close', writeGuards, wrap(async (req, res) => {
    const result = await hardClosePeriod(input(req, { periodId: req.params.id }))
    return res.status(200).json(result)
  }))

  app.post('/api/admin/fin/accounting/periods/:id/reopen', writeGuards, wrap(async (req, res) => {
    const result = await reopenPeriod(input(req, { periodId: req.params.id }))
    return res.status(200).json(result)
  }))
}

export const __testables = {
  requireExplicitPlatformAdmin,
  registerFinVendorAdminRoutes,
  deferredExceptionPayload,
}
