import { expect, it } from 'vitest'
import { asRole } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertControls } from '../funding/test-support.js'
import { commandEnv } from '../testing/seed.js'
import { openDunningCase } from './cases.js'
import { advanceDunning } from './steps.js'
import { seedIssuedInvoice } from '../billing/test-support.js'

finPostgresSuite('dunning steps APPEND_ONLY', {}, ({ pool, world }) => {
  it('UPDATE as fin_app_role is rejected', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const issued = await seedIssuedInvoice(pool(), world(), {
      dueAt: '2020-01-01T00:00:00.000Z',
    })
    const opened = await openDunningCase({
      ...env,
      invoiceId: issued.invoiceId,
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: '2020-01-01T00:00:00.000Z',
      policyDelayMs: 0,
    })
    await advanceDunning({ ...env, caseId: opened.caseId, now: new Date().toISOString() })
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }, async (c) => c.query(
        `UPDATE fin.dunning_steps SET outcome = 'TAMPER' WHERE case_id = $1`,
        [opened.caseId],
      ))).rejects.toBeTruthy()
    } finally {
      client.release()
    }
  })
})
