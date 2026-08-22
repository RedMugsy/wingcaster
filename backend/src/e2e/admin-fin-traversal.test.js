/**
 * Spec §130 traversal: the four economic paths are joinable on fin.*
 * without commercial.*. Playwright is not in web/package.json (DL-160);
 * this is the real-Postgres traversal plus the jsdom page walk in web/.
 */
import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../fin/testing/suite.js'
import { OVERVIEW_KPI_KEYS } from '../fin/admin/kpis.js'
import { EXCEPTION_TYPES } from '../fin/admin/exceptions.js'
import { makeOpsApp } from '../fin/admin/http-support.js'

finPostgresSuite('e2e/admin-fin-traversal', {}, ({ url, pool }) => {
  it('§130 path 1 — invoice → line → adjustment → rated_usage → contract → price → meter → usage_events', async () => {
    const result = await pool().query(`
      SELECT 1
        FROM fin.invoices i
        LEFT JOIN fin.invoice_lines l ON l.invoice_id = i.id
        LEFT JOIN fin.invoice_adjustments adj ON adj.invoice_id = i.id
        LEFT JOIN fin.rated_usage ru
          ON ru.id = l.source_id AND l.source_type = 'RATED_USAGE'
        LEFT JOIN fin.contract_versions cv ON cv.id = ru.contract_version_id
        LEFT JOIN fin.price_versions pv ON pv.id = ru.price_version_id
        LEFT JOIN fin.metered_usage mu ON mu.id = ru.metered_usage_id
        LEFT JOIN fin.metered_usage_sources mus ON mus.metered_usage_id = mu.id
        LEFT JOIN fin.usage_events ue
          ON ue.id = mus.usage_event_id AND ue.residency_key = mus.residency_key
       LIMIT 1
    `)
    expect(result.rows).toBeTruthy()
  })

  it('§130 path 2 — rated_usage → holds → lots → ledger_transactions → postings → balances', async () => {
    const result = await pool().query(`
      SELECT 1
        FROM fin.rated_usage ru
        LEFT JOIN fin.holds h ON h.subject_id = ru.id
        LEFT JOIN fin.lots lot ON lot.tenant_id = ru.tenant_id
        LEFT JOIN fin.ledger_transactions tx ON tx.book_id = lot.book_id
        LEFT JOIN fin.ledger_postings p ON p.transaction_id = tx.id
        LEFT JOIN fin.account_balances b ON b.account_id = p.account_id
       LIMIT 1
    `)
    expect(result.rows).toBeTruthy()
  })

  it('§130 path 3 — lot → purchase_intents → accounting_events', async () => {
    const result = await pool().query(`
      SELECT 1
        FROM fin.lots lot
        LEFT JOIN fin.purchase_intents pi ON pi.id = lot.purchase_intent_id
        LEFT JOIN fin.accounting_events ae ON ae.source_id = lot.id AND ae.source_type = 'LOT'
       LIMIT 1
    `)
    expect(result.rows).toBeTruthy()
  })

  it('§130 path 4 — usage_events → vendor tables (empty until Stage 11)', async () => {
    const result = await pool().query(`
      SELECT 1 FROM fin.usage_events LIMIT 1
    `)
    expect(result.rows).toBeTruthy()
  })

  it('admin GET surfaces used by the fin ops pages all 200', async () => {
    const { app } = await makeOpsApp(url())
    const paths = [
      '/api/admin/fin/overview',
      '/api/admin/fin/tenants',
      '/api/admin/fin/usage',
      '/api/admin/fin/credits/lots',
      '/api/admin/fin/holds',
      '/api/admin/fin/facilities',
      '/api/admin/fin/contracts',
      '/api/admin/fin/pricing',
      '/api/admin/fin/invoices',
      '/api/admin/fin/payments',
      '/api/admin/fin/reconciliation/runs',
      '/api/admin/fin/cutover/readiness',
      '/api/admin/fin/cutover/parity',
      '/api/admin/fin/exceptions',
      '/api/admin/fin/approvals',
      '/api/admin/fin/audit',
      '/api/admin/fin/configuration',
      '/api/admin/fin/dunning/cases',
      '/api/admin/fin/vendors',
    ]
    for (const path of paths) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(200)
    }
    const overview = await request(app).get('/api/admin/fin/overview')
    expect(overview.body.keys).toHaveLength(24)
    expect(overview.body.keys).toEqual([...OVERVIEW_KPI_KEYS])
    const exceptions = await request(app).get('/api/admin/fin/exceptions')
    expect(exceptions.body.types).toHaveLength(18)
    expect(exceptions.body.types.map((row) => row.type)).toEqual(
      EXCEPTION_TYPES.map((row) => row.type),
    )
  })
})
