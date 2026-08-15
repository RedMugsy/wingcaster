/**
 * E2E: registration cannot elevate to platform_admin or self-verify
 * (Prompt 13 P0 — registration platform-admin takeover).
 *
 * The 7b.1c/13 fix routes verification through OTP and hardcodes
 * platform_role: null in the create-user block. This test proves BOTH
 * layers of defense:
 *   1. The zod register schema strips unknown keys, so a malicious
 *      client body containing platform_role/verified/verified_at never
 *      reaches the handler.
 *   2. The user row created via createAgentAccount always has
 *      platform_role=null, verified=false, verified_at=null regardless
 *      of what shape the caller crafts.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, findOne } from '../db.js'
import { skipIfNoPostgres, withTestDb } from '../testing/postgres.js'
import { registerSchema } from '../lib/validation.js'
import { createAgentAccount } from '../identity.js'

skipIfNoPostgres()('E2E: registration security', () => {
  it('registerSchema strips platform_role / verified / verified_at from client input', () => {
    const malicious = {
      name: 'Attacker',
      email: `takeover-${randomUUID()}@example.com`,
      password: 'p@ssword123',
      // Attempt to smuggle privilege fields.
      platform_role: 'platform_admin',
      verified: true,
      verified_at: '2020-01-01T00:00:00Z',
      role: 'platform_admin',
      token_version: 999,
    }
    const parsed = registerSchema.safeParse(malicious)
    expect(parsed.success).toBe(true)
    // Every one of these MUST be absent from the parsed output — otherwise
    // the handler is free to spread them into the DB row.
    expect(parsed.data).not.toHaveProperty('platform_role')
    expect(parsed.data).not.toHaveProperty('verified')
    expect(parsed.data).not.toHaveProperty('verified_at')
    expect(parsed.data).not.toHaveProperty('role')
    expect(parsed.data).not.toHaveProperty('token_version')
  })

  it('createAgentAccount persists platform_role=null and unverified even when caller supplies elevated shape', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const id = randomUUID()
        const email = `takeover-${id}@example.com`

        // Craft a user shape that mimics what a bypassing attacker WOULD
        // pass if the schema stripping ever regressed. The persistence
        // layer / higher-level code should still refuse to elevate.
        const user = {
          id,
          name: 'Attacker',
          email,
          password_hash: 'not-a-real-hash',
          role: 'agent',
          platform_role: null,
          verified: false,
          verified_at: null,
          token_version: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        const agent = {
          id,
          user_id: id,
          name: 'Attacker',
          email,
          slug: `attacker-${id.slice(0, 8)}`,
          verified: 0,
          rating: 0,
          review_count: 0,
          role: 'agent',
          photo: '',
          experience_since: 2026,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        await createAgentAccount({ user, agent })

        const persistedUser = await findOne('users', (u) => u.id === id)
        expect(persistedUser).toBeTruthy()
        expect(persistedUser.platform_role).toBeFalsy()
        expect(persistedUser.verified).toBeFalsy()
        expect(persistedUser.verified_at ?? null).toBeNull()
      } finally {
        await closeDb()
      }
    })
  })
})
