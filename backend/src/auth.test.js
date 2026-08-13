import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('auth bootstrap', () => {
  const originalSecret = process.env.JWT_SECRET

  beforeEach(() => {
    delete process.env.JWT_SECRET
    vi.resetModules()
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET
    } else {
      process.env.JWT_SECRET = originalSecret
    }
    vi.resetModules()
  })

  it('uses a development fallback secret when JWT_SECRET is missing', async () => {
    const { signToken, verifyToken } = await import('./auth.js')
    const token = signToken({ id: 'agent-1' })
    const payload = verifyToken(token)

    expect(payload).toMatchObject({ id: 'agent-1' })
  })
})
