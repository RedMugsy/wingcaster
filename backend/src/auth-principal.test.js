import { beforeEach, describe, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findAgentForUser: vi.fn(),
}))

vi.mock('./identity.js', () => identity)

describe('canonical principal authentication', () => {
  beforeEach(() => {
    vi.resetModules()
    identity.findUserById.mockReset()
    identity.findAgentForUser.mockReset()
  })

  it('loads role and session version from users while preserving the active token subject', async () => {
    const { authMiddleware, signToken } = await import('./auth.js')
    identity.findUserById.mockResolvedValue({
      id: 'principal-1',
      email: 'agent@example.test',
      name: 'Agent',
      role: 'agent',
      platform_role: 'platform_admin',
      token_version: 3,
      verified: true,
      verified_at: '2026-08-15T00:00:00.000Z',
    })
    identity.findAgentForUser.mockResolvedValue({
      id: 'principal-1',
      user_id: 'principal-1',
      role: 'agent',
    })

    const req = {
      headers: {
        authorization: `Bearer ${signToken({
          id: 'principal-1',
          role: 'platform_admin',
          token_version: 3,
          verified_at: '2026-08-15T00:00:00.000Z',
        })}`,
      },
    }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(identity.findUserById).toHaveBeenCalledWith('principal-1')
    expect(identity.findAgentForUser).toHaveBeenCalledWith('principal-1')
    expect(req.user).toMatchObject({
      id: 'principal-1',
      agent_id: 'principal-1',
      role: 'agent',
      platform_role: 'platform_admin',
      token_version: 3,
    })
    expect(req.agent.id).toBe('principal-1')
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('rejects a token whose version no longer matches the user principal', async () => {
    const { authMiddleware, signToken } = await import('./auth.js')
    identity.findUserById.mockResolvedValue({
      id: 'principal-1',
      role: 'agent',
      token_version: 4,
      verified: true,
      verified_at: '2026-08-15T00:00:00.000Z',
    })
    identity.findAgentForUser.mockResolvedValue({ id: 'principal-1', user_id: 'principal-1' })

    const req = {
      headers: {
        authorization: `Bearer ${signToken({ id: 'principal-1', token_version: 3, verified_at: '2026-08-15T00:00:00.000Z' })}`,
      },
    }
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired. Please sign in again.' })
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a token issued before verified_at claims were required', async () => {
    const { authMiddleware, signToken } = await import('./auth.js')
    const req = { headers: { authorization: `Bearer ${signToken({ id: 'principal-1', token_version: 0 })}` } }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
    const next = vi.fn()

    await authMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Session verification required' })
    expect(identity.findUserById).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})
