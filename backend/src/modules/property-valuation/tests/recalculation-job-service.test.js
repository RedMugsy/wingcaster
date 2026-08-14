import { describe, it, expect, vi } from 'vitest'
import { createRecalculationJobService } from '../application/recalculation-job-service.js'

const logger = { error: () => {}, warn: () => {}, debug: () => {}, info: () => {}, child: () => logger }

function createDal(seed = {}) {
  const store = {
    pricing_recalculation_jobs: [],
    pricing_recalculation_job_items: [],
    property_price_analyses: [],
    ...seed,
  }
  return {
    store,
    findAll: (collection, filter = () => true) => Promise.resolve((store[collection] || []).filter(filter)),
    findOne: (collection, filter) => Promise.resolve((store[collection] || []).find(filter) || null),
    insert: (collection, item) => { (store[collection] ||= []).push(item); return Promise.resolve(item) },
    update: (collection, filter, updater) => {
      let count = 0
      store[collection] = (store[collection] || []).map((item) => {
        if (!filter(item)) return item
        count++
        return updater(item)
      })
      return Promise.resolve(count)
    },
    remove: vi.fn().mockResolvedValue(0),
  }
}

function createService(dal) {
  const properties = [
    { id: 'p1', status: 'active', property_type: 'villa', city: 'Batroun' },
    { id: 'p2', status: 'active', property_type: 'apartment', city: 'Beirut' },
  ]
  return createRecalculationJobService({
    dal,
    adapter: {
      getPropertyById: (id) => Promise.resolve(properties.find((property) => property.id === id) || null),
      getProperties: ({ property_type } = {}) => Promise.resolve(properties.filter((property) => !property_type || property.property_type === property_type)),
      getAreaById: (id) => Promise.resolve(id === 'a1' ? { id: 'a1', name: 'Batroun' } : null),
    },
    comparableService: {
      resolveAreaForProperty: (property) => Promise.resolve(property.city === 'Batroun' ? { id: 'a1', name: 'Batroun' } : { id: 'a2', name: 'Beirut' }),
    },
    analysisService: { getAnalysis: vi.fn().mockResolvedValue({}) },
    config: { recalculationJobMaxAttempts: 3, recalculationJobBatchSize: 25 },
    logger,
  })
}

describe('Recalculation Job Service', () => {
  it('persists a scoped property job and its item', async () => {
    const dal = createDal()
    const service = createService(dal)
    const job = await service.enqueue({ property_id: 'p1', force_recompute: true }, 'admin-1')

    expect(job).toMatchObject({ requested_by: 'admin-1', scope_type: 'property', total_items: 1, status: 'queued' })
    expect(dal.store.pricing_recalculation_job_items).toHaveLength(1)
    expect(dal.store.pricing_recalculation_job_items[0]).toMatchObject({ job_id: job.id, property_id: 'p1', status: 'queued' })
  })

  it('coalesces an equivalent runnable job', async () => {
    const dal = createDal()
    const service = createService(dal)
    const first = await service.enqueue({ property_id: 'p1' }, 'admin-1')
    const second = await service.enqueue({ property_id: 'p1' }, 'admin-2')

    expect(second.id).toBe(first.id)
    expect(dal.store.pricing_recalculation_jobs).toHaveLength(1)
  })

  it('invalidates affected analyses and queues an area/type job', async () => {
    const dal = createDal({
      property_price_analyses: [
        { id: 'analysis-1', property_id: 'p1', expires_at: '2099-01-01T00:00:00.000Z', data: {} },
        { id: 'analysis-2', property_id: 'p2', expires_at: '2099-01-01T00:00:00.000Z', data: {} },
      ],
    })
    const service = createService(dal)
    const job = await service.invalidateForPropertyChange({ id: 'p1', property_type: 'villa', city: 'Batroun' })

    expect(job).toMatchObject({ scope_type: 'area', scope_area_id: 'a1', scope_property_type: 'villa' })
    expect(new Date(dal.store.property_price_analyses[0].expires_at).getTime()).toBeLessThanOrEqual(Date.now())
    expect(dal.store.property_price_analyses[1].expires_at).toBe('2099-01-01T00:00:00.000Z')
  })
})
