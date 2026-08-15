import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure } from '../../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../../testing/postgres.js'
import { claimProcessedMessage, releaseProcessedMessage } from '../infrastructure/db.js'

skipIfNoPostgres()('wa_listings.processed_messages — atomic claim', () => {
  it('two concurrent claims for the same message_id: exactly one wins', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const messageId = `wa_test_${randomUUID()}`
        const from = '96131234567'

        // Fire N racing claims. Only one should return claimed:true.
        const N = 5
        const results = await Promise.all(
          Array.from({ length: N }, () => claimProcessedMessage(messageId, from)),
        )

        const winners = results.filter((r) => r.claimed === true)
        const losers = results.filter((r) => r.claimed === false)

        expect(winners).toHaveLength(1)
        expect(losers).toHaveLength(N - 1)
      } finally {
        await closeDb()
      }
    })
  })

  it('release lets a subsequent claim succeed (provider retry after failure)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const messageId = `wa_test_${randomUUID()}`
        const from = '96131234568'

        const first = await claimProcessedMessage(messageId, from)
        expect(first.claimed).toBe(true)

        // Simulate a pipeline failure — the caller rolls back its claim.
        await releaseProcessedMessage(messageId)

        // Provider retries the same delivery — must succeed.
        const retry = await claimProcessedMessage(messageId, from)
        expect(retry.claimed).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('release without a prior claim is a no-op (idempotent)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        // Should not throw.
        await releaseProcessedMessage(`wa_never_${randomUUID()}`)
      } finally {
        await closeDb()
      }
    })
  })
})
