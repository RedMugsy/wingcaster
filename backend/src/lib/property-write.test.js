import { describe, expect, it, vi } from 'vitest'
import { createPropertyWithCanonical } from './property-write.js'

describe('createPropertyWithCanonical', () => {
  it('creates the canonical record only after the property insert succeeds', async () => {
    const createProperty = vi.fn().mockResolvedValue({ id: 'prop-1' })
    const createCanonical = vi.fn().mockResolvedValue({ id: 'canon-1' })
    const transaction = vi.fn(async (work) => work())

    const property = await createPropertyWithCanonical({
      transaction,
      createProperty,
      createCanonical,
    })

    expect(property.id).toBe('prop-1')
    expect(createProperty).toHaveBeenCalledOnce()
    expect(createCanonical).toHaveBeenCalledWith('prop-1')
  })

  it('does not create the canonical record when property creation fails', async () => {
    const createProperty = vi.fn().mockRejectedValue(new Error('boom'))
    const createCanonical = vi.fn()
    const transaction = vi.fn(async (work) => work())

    await expect(createPropertyWithCanonical({ transaction, createProperty, createCanonical })).rejects.toThrow('boom')
    expect(createCanonical).not.toHaveBeenCalled()
  })
})
