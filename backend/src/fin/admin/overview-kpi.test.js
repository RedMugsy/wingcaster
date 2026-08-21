import request from 'supertest'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { OVERVIEW_KPI_KEYS } from './kpis.js'
import { makeOpsApp } from './http-support.js'

finPostgresSuite('admin/overview-kpi', {}, ({ url }) => {
  it('returns all 24 §103 KPI keys as numbers', async () => {
    const { app } = await makeOpsApp(url())
    const res = await request(app).get('/api/admin/fin/overview')
    expect(res.status).toBe(200)
    expect(res.body.keys).toEqual([...OVERVIEW_KPI_KEYS])
    expect(OVERVIEW_KPI_KEYS).toHaveLength(24)
    for (const key of OVERVIEW_KPI_KEYS) {
      expect(typeof res.body.tiles[key]).toBe('number')
      expect(Number.isNaN(res.body.tiles[key])).toBe(false)
    }
  })

  it('ignores environment on the query string and uses the session', async () => {
    const { app } = await makeOpsApp(url(), { finEnvironment: 'LIVE' })
    const res = await request(app).get('/api/admin/fin/overview?environment=TEST')
    expect(res.status).toBe(200)
    expect(res.body.environment).toBe('LIVE')
  })
})
