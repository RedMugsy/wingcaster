/**
 * SELECT-only helpers for Stage 12 admin read routes.
 */
import { query } from '../../db.js'

function envParams(environment, extra = []) {
  return [environment, ...extra]
}

export async function listTenants({ environment, limit = 100 }) {
  return query(
    `SELECT t.id, t.public_tenant_id, t.environment, t.status,
            COALESCE(l.remaining_units, 0)::bigint AS remaining_units,
            COALESCE(l.lot_count, 0)::bigint AS lot_count,
            COALESCE(l.consideration_minor, 0)::bigint AS credit_exposure_minor,
            COALESCE(h.open_holds, 0)::bigint AS open_holds,
            COALESCE(f.limit_minor, 0)::bigint AS facility_limit_minor,
            COALESCE(ar.ar_minor, 0)::bigint AS ar_outstanding_minor,
            COALESCE(u.unapplied_minor, 0)::bigint AS unapplied_cash_minor,
            d.status AS dunning_status
       FROM fin.tenants t
       LEFT JOIN LATERAL (
         SELECT SUM(remaining_units) AS remaining_units,
                COUNT(*) AS lot_count,
                SUM(consideration_minor) AS consideration_minor
           FROM fin.lots WHERE tenant_id = t.id AND status = 'ACTIVE'
       ) l ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_holds FROM fin.holds
          WHERE tenant_id = t.id AND status = 'OPEN'
       ) h ON true
       LEFT JOIN LATERAL (
         SELECT SUM(limit_minor) AS limit_minor FROM fin.credit_facilities
          WHERE tenant_id = t.id AND status IN ('ACTIVE', 'PAUSED', 'SUSPENDED')
       ) f ON true
       LEFT JOIN LATERAL (
         SELECT SUM(i.total_minor) AS ar_minor FROM fin.invoices i
          WHERE i.tenant_id = t.id AND i.status IN ('ISSUED', 'PART_PAID')
       ) ar ON true
       LEFT JOIN LATERAL (
         SELECT SUM(balance_minor) AS unapplied_minor FROM fin.unapplied_cash
          WHERE tenant_id = t.id
       ) u ON true
       LEFT JOIN LATERAL (
         SELECT status FROM fin.dunning_cases
          WHERE tenant_id = t.id
            AND status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED')
          ORDER BY created_at DESC LIMIT 1
       ) d ON true
      WHERE t.environment = $1
      ORDER BY t.created_at DESC
      LIMIT $2`,
    envParams(environment, [limit]),
  )
}

export async function getTenant({ environment, id }) {
  const rows = await query(
    `SELECT t.*,
            COALESCE(l.remaining_units, 0)::bigint AS remaining_units,
            COALESCE(l.lot_count, 0)::bigint AS lot_count,
            COALESCE(l.granted_units, 0)::bigint AS granted_units,
            COALESCE(l.consideration_minor, 0)::bigint AS credit_exposure_minor,
            COALESCE(h.open_holds, 0)::bigint AS open_holds,
            COALESCE(h.held_units, 0)::bigint AS held_units,
            COALESCE(f.limit_minor, 0)::bigint AS facility_limit_minor,
            COALESCE(f.facility_count, 0)::bigint AS facility_count,
            COALESCE(ar.ar_minor, 0)::bigint AS ar_outstanding_minor,
            COALESCE(u.unapplied_minor, 0)::bigint AS unapplied_cash_minor,
            d.status AS dunning_status,
            d.id AS dunning_case_id,
            ba.id AS billing_account_id,
            ho.id AS holder_id
       FROM fin.tenants t
       LEFT JOIN LATERAL (
         SELECT SUM(remaining_units) AS remaining_units,
                SUM(granted_units) AS granted_units,
                COUNT(*) AS lot_count,
                SUM(consideration_minor) AS consideration_minor
           FROM fin.lots WHERE tenant_id = t.id AND status = 'ACTIVE'
       ) l ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_holds, COALESCE(SUM(units), 0) AS held_units
           FROM fin.holds WHERE tenant_id = t.id AND status = 'OPEN'
       ) h ON true
       LEFT JOIN LATERAL (
         SELECT SUM(limit_minor) AS limit_minor, COUNT(*) AS facility_count
           FROM fin.credit_facilities
          WHERE tenant_id = t.id AND status IN ('ACTIVE', 'PAUSED', 'SUSPENDED')
       ) f ON true
       LEFT JOIN LATERAL (
         SELECT SUM(total_minor) AS ar_minor FROM fin.invoices
          WHERE tenant_id = t.id AND status IN ('ISSUED', 'PART_PAID')
       ) ar ON true
       LEFT JOIN LATERAL (
         SELECT SUM(balance_minor) AS unapplied_minor FROM fin.unapplied_cash
          WHERE tenant_id = t.id
       ) u ON true
       LEFT JOIN LATERAL (
         SELECT id, status FROM fin.dunning_cases
          WHERE tenant_id = t.id
            AND status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED')
          ORDER BY created_at DESC LIMIT 1
       ) d ON true
       LEFT JOIN LATERAL (
         SELECT id FROM fin.billing_accounts
          WHERE tenant_id = t.id ORDER BY created_at ASC LIMIT 1
       ) ba ON true
       LEFT JOIN LATERAL (
         SELECT id FROM fin.holders
          WHERE tenant_id = t.id AND holder_kind = 'TENANT_ROOT'
          ORDER BY created_at ASC LIMIT 1
       ) ho ON true
      WHERE t.environment = $1 AND t.id = $2`,
    [environment, id],
  )
  return rows[0] || null
}

export async function usageDrill({ environment, tenantId, holderId, billingAccountId, bookId, accountType }) {
  if (accountType && bookId) {
    return {
      level: 'posting',
      rows: await query(
        `SELECT p.id, p.account_id, p.amount_units, p.created_at, a.account_type
           FROM fin.ledger_postings p
           JOIN fin.ledger_accounts a ON a.id = p.account_id
          WHERE p.environment = $1 AND a.book_id = $2 AND a.account_type = $3
          ORDER BY p.created_at DESC LIMIT 200`,
        [environment, bookId, accountType],
      ),
    }
  }
  if (bookId) {
    return {
      level: 'account_type',
      rows: await query(
        `SELECT a.account_type, a.id AS account_id,
                COALESCE(b.balance_units, 0)::bigint AS balance_units
           FROM fin.ledger_accounts a
           LEFT JOIN fin.account_balances b ON b.account_id = a.id
          WHERE a.environment = $1 AND a.book_id = $2
          ORDER BY a.account_type`,
        [environment, bookId],
      ),
    }
  }
  if (billingAccountId) {
    return {
      level: 'book',
      rows: await query(
        `SELECT id, book_type, currency, environment
           FROM fin.ledger_books
          WHERE environment = $1 AND billing_account_id = $2
          ORDER BY book_type`,
        [environment, billingAccountId],
      ),
    }
  }
  if (holderId) {
    return {
      level: 'billing_account',
      rows: await query(
        `SELECT ba.id, ba.billing_currency AS currency, ba.environment
           FROM fin.billing_accounts ba
           JOIN fin.holders h ON h.tenant_id = ba.tenant_id
          WHERE ba.environment = $1 AND h.id = $2
          ORDER BY ba.created_at`,
        [environment, holderId],
      ),
    }
  }
  if (tenantId) {
    return {
      level: 'holder',
      rows: await query(
        `SELECT id, holder_kind, environment FROM fin.holders
          WHERE environment = $1 AND tenant_id = $2
          ORDER BY created_at`,
        [environment, tenantId],
      ),
    }
  }
  return {
    level: 'tenant',
    rows: await query(
      `SELECT id, public_tenant_id, status, environment
         FROM fin.tenants WHERE environment = $1
         ORDER BY created_at DESC LIMIT 100`,
      [environment],
    ),
  }
}

export async function listLots({ environment, tenantId }) {
  const params = tenantId ? [environment, tenantId] : [environment]
  const filter = tenantId ? 'AND tenant_id = $2' : ''
  return query(
    `SELECT id, tenant_id, holder_id, billing_account_id, source_kind, status,
            granted_units, remaining_units, consideration_minor, currency,
            expires_at, issued_at
       FROM fin.lots WHERE environment = $1 ${filter}
       ORDER BY issued_at DESC NULLS LAST LIMIT 200`,
    params,
  )
}

export async function listHolds({ environment }) {
  return query(
    `SELECT id, tenant_id, holder_id, billing_account_id, units, status,
            expires_at, created_at
       FROM fin.holds WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function listFacilities({ environment }) {
  return query(
    `SELECT id, tenant_id, billing_account_id, currency, limit_minor,
            net_terms_days, status, valid_from, valid_to, version
       FROM fin.credit_facilities WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function listContracts({ environment }) {
  return query(
    `SELECT id, tenant_id, billing_account_id, contract_number, status,
            billing_currency, starts_at, ends_at, version
       FROM fin.contracts WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function listInvoices({ environment }) {
  return query(
    `SELECT id, tenant_id, billing_account_id, status, invoice_number,
            currency, total_minor, issued_at, due_at, version
       FROM fin.invoices WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function getInvoice({ environment, id }) {
  const header = (await query(
    `SELECT * FROM fin.invoices WHERE environment = $1 AND id = $2`,
    [environment, id],
  ))[0]
  if (!header) return null
  const lines = await query(
    `SELECT * FROM fin.invoice_lines WHERE invoice_id = $1 ORDER BY line_no`,
    [id],
  )
  const taxLines = await query(
    `SELECT * FROM fin.invoice_tax_lines WHERE invoice_id = $1`,
    [id],
  )
  const adjustments = await query(
    `SELECT * FROM fin.invoice_adjustments WHERE invoice_id = $1 ORDER BY created_at`,
    [id],
  )
  const allocations = await query(
    `SELECT * FROM fin.invoice_payment_allocations WHERE invoice_id = $1`,
    [id],
  )
  return { ...header, lines, tax_lines: taxLines, adjustments, allocations }
}

export async function getBillingPeriod({ environment, id }) {
  const rows = await query(
    `SELECT id, status, version FROM fin.billing_periods
      WHERE environment = $1 AND id = $2`,
    [environment, id],
  )
  return rows[0] || null
}

export async function listPayments({ environment }) {
  return query(
    `SELECT id, tenant_id, billing_account_id, status, amount_minor, currency,
            provider, provider_event_id, received_at, version
       FROM fin.payments WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function listReconRuns({ environment }) {
  return query(
    `SELECT id, environment, started_at, finished_at, scope, status, schedule_kind
       FROM fin.reconciliation_runs WHERE environment = $1
       ORDER BY started_at DESC LIMIT 50`,
    [environment],
  )
}

export async function getReconRun({ environment, id }) {
  const run = (await query(
    `SELECT * FROM fin.reconciliation_runs WHERE environment = $1 AND id = $2`,
    [environment, id],
  ))[0]
  if (!run) return null
  const checks = await query(
    `SELECT * FROM fin.reconciliation_checks WHERE run_id = $1 ORDER BY check_code`,
    [id],
  )
  const drifts = await query(
    `SELECT d.*, r.id AS resolution_id, r.action, r.resolved_at
       FROM fin.reconciliation_drift d
       JOIN fin.reconciliation_checks c ON c.id = d.check_id
       LEFT JOIN fin.reconciliation_resolution r ON r.drift_id = d.id
      WHERE c.run_id = $1
      ORDER BY d.created_at`,
    [id],
  )
  return { ...run, checks, drifts }
}

export async function listApprovals({ environment }) {
  return query(
    `SELECT id, tenant_id, action_kind, status, payload_hash, created_at, updated_at
       FROM fin.approval_requests WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function listAudit({ environment, limit = 100 }) {
  return query(
    `SELECT id, actor_type, actor_id, actor_email_snapshot, action, target_type,
            target_id, reason_code, created_at
       FROM fin.financial_audit_events WHERE environment = $1
       ORDER BY created_at DESC LIMIT $2`,
    [environment, limit],
  )
}

export async function listConfiguration({ environment }) {
  const dunning = await query(
    `SELECT id, tenant_id, billing_account_id, status, created_at
       FROM fin.dunning_cases WHERE environment = $1
       ORDER BY created_at DESC LIMIT 20`,
    [environment],
  )
  const facilities = await query(
    `SELECT currency, COUNT(*)::bigint AS qty,
            COALESCE(SUM(limit_minor), 0)::bigint AS limit_minor
       FROM fin.credit_facilities WHERE environment = $1
       GROUP BY currency`,
    [environment],
  )
  return {
    environment,
    dunning_policies: dunning,
    tax_registrations: { placeholder: true, stage: 'future', rows: [] },
    facility_defaults: facilities,
  }
}

export async function listDunningCases({ environment }) {
  return query(
    `SELECT id, tenant_id, billing_account_id, invoice_id, status, created_at
       FROM fin.dunning_cases WHERE environment = $1
       ORDER BY created_at DESC LIMIT 200`,
    [environment],
  )
}

export async function simulatePrice({ model, billableUnits, unitRateMinor, packageSizeUnits, tiers, dimensions, eventDimensions }) {
  const { computeAmountMinor } = await import('../rating/engine.js')
  const amount = computeAmountMinor(model || 'PER_UNIT', {
    billableUnits: billableUnits ?? 0,
    unitRateMinor: unitRateMinor ?? 0,
    packageSizeUnits,
    tiers: tiers || [],
    dimensions: dimensions || [],
    eventDimensions: eventDimensions || {},
  })
  return {
    model: model || 'PER_UNIT',
    amount_minor: amount.toString(),
  }
}
