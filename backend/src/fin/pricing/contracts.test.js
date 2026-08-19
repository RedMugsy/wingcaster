import { expect, it } from 'vitest'
import { insertApproval, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  activateContractVersion,
  createContract,
  draftContractVersion,
  suspendContract,
  terminateContract,
} from './contracts.js'

function contractEnv(world, extra = {}) {
  return {
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    reasonCode: extra.reasonCode || 'TEST',
    actorType: extra.actorType || 'SYSTEM',
    now: world.now,
    ...extra,
  }
}

function newContractInput(world, extra = {}) {
  return contractEnv(world, {
    billingAccountId: world.tenantA.billingAccountId,
    sellerLegalEntityId: world.legalEntityId,
    contractNumber: extra.contractNumber || `C-${Date.now()}-${Math.random()}`,
    billingCurrency: 'USD',
    billingTimezone: 'Asia/Riyadh',
    ...extra,
  })
}

finPostgresSuite('fin.pricing contracts commands', {}, ({ pool, world }) => {
  it('createContract writes DRAFT header + audit + outbox and no ledger txs', async () => {
    const created = await createContract(newContractInput(world()))
    const row = await pool().query(`SELECT status FROM fin.contracts WHERE id = $1`, [created.id])
    expect(row.rows[0].status).toBe('DRAFT')
    const audit = await pool().query(
      `SELECT action FROM fin.financial_audit_events WHERE target_id = $1`,
      [created.id],
    )
    expect(audit.rows.map((r) => r.action)).toContain('CONTRACT_CREATED')
    const txs = await pool().query(`SELECT COUNT(*)::int AS n FROM fin.ledger_transactions`)
    expect(txs.rows[0].n).toBe(0)
  })

  it('draftContractVersion writes DRAFT version + components', async () => {
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-1' }))
    const drafted = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: NOW,
      components: [{
        component_type: 'METER_PRICE',
        config: { note: 'usage' },
      }],
    }))
    const version = await pool().query(
      `SELECT status, version_n FROM fin.contract_versions WHERE id = $1`,
      [drafted.id],
    )
    expect(version.rows[0].status).toBe('DRAFT')
    expect(Number(version.rows[0].version_n)).toBe(1)
    const comps = await pool().query(
      `SELECT component_type FROM fin.contract_components WHERE contract_version_id = $1`,
      [drafted.id],
    )
    expect(comps.rows[0].component_type).toBe('METER_PRICE')
  })

  it('activateContractVersion makes the parent contract ACTIVE', async () => {
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-ACT' }))
    const drafted = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: NOW,
    }))
    const activated = await activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: drafted.id,
    }))
    expect(activated.status).toBe('ACTIVE')
    expect(activated.contractStatus).toBe('ACTIVE')
    const header = await pool().query(`SELECT status FROM fin.contracts WHERE id = $1`, [created.id])
    expect(header.rows[0].status).toBe('ACTIVE')
    const version = await pool().query(
      `SELECT status FROM fin.contract_versions WHERE id = $1`,
      [drafted.id],
    )
    expect(version.rows[0].status).toBe('ACTIVE')
  })

  it('activating a successor supersedes the previous ACTIVE version', async () => {
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-SUP' }))
    const v1 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: '2026-01-01T00:00:00.000Z',
    }))
    await activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v1.id,
    }))
    const v2 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: NOW,
    }))
    await activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v2.id,
    }))
    const rows = await pool().query(
      `SELECT status FROM fin.contract_versions WHERE contract_id = $1 ORDER BY version_n`,
      [created.id],
    )
    expect(rows.rows.map((r) => r.status)).toEqual(['SUPERSEDED', 'ACTIVE'])
  })

  it('overlap on activate surfaces FIN_CONTRACT_VERSION_OVERLAP', async () => {
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-OV' }))
    const v1 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: NOW,
    }))
    await activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v1.id,
    }))
    await pool().query(
      `UPDATE fin.contract_versions SET status = 'SUPERSEDED' WHERE id = $1`,
      [v1.id],
    )
    const v2 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: NOW,
    }))
    await expect(activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v2.id,
    }))).rejects.toMatchObject({ code: 'FIN_CONTRACT_VERSION_OVERLAP' })
  })

  it('backdated activate without approval throws BACKDATED_AMENDMENT_REQUIRED', async () => {
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-BD' }))
    const v1 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: '2020-01-01T00:00:00.000Z',
    }))
    await expect(activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v1.id,
    }))).rejects.toMatchObject({ code: 'BACKDATED_AMENDMENT_REQUIRED' })
  })

  it('backdated activate with EXECUTED approval succeeds', async () => {
    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'BACKDATED_AMENDMENT',
      status: 'EXECUTED',
    })
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-BD-OK' }))
    const v1 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: '2020-01-01T00:00:00.000Z',
    }))
    const activated = await activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v1.id,
      approvalRequestId: approvalId,
    }))
    expect(activated.status).toBe('ACTIVE')
  })

  it('suspendContract and terminateContract follow B §14', async () => {
    const created = await createContract(newContractInput(world(), { contractNumber: 'CV-ST' }))
    const v1 = await draftContractVersion(contractEnv(world(), {
      contractId: created.id,
      effective_from: NOW,
    }))
    await activateContractVersion(contractEnv(world(), {
      contractId: created.id,
      contractVersionId: v1.id,
    }))
    const suspended = await suspendContract(contractEnv(world(), { contractId: created.id }))
    expect(suspended.status).toBe('SUSPENDED')
    const terminated = await terminateContract(contractEnv(world(), { contractId: created.id }))
    expect(terminated.status).toBe('TERMINATED')
  })
})
