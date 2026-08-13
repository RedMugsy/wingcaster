/**
 * WhatsApp Listing module background worker.
 *
 * Polls module sessions on a setInterval timer and:
 *   1. Transitions COLLECTING sessions whose intake window has passed to EXTRACTING.
 *   2. Runs pipeline extraction.
 *   3. Discards AWAITING_APPROVAL sessions that have been idle too long.
 *   4. Prunes expired sessions and old processed-message dedupe records.
 */

import { v4 as uuidv4 } from 'uuid'
import { Collections, findAllModule, findOneModule, removeModule, insertModule, updateModule } from './db.js'
import { SessionState, DraftStatus } from '../domain/types.js'

const MAX_RETRIES = 5
const BASE_BACKOFF_MS = 5000

export function createQueue({ pipeline, config, logger }) {
  let timer = null
  let running = false

  function isRunning() {
    return running || Boolean(timer)
  }

  async function tick() {
    if (running) return
    running = true
    try {
      await processIntakeWindows()
      await processRetries()
      await processApprovalTimeouts()
      await pruneDedupeRecords()
    } catch (err) {
      logger.error({ err: err.message || String(err) }, 'WhatsApp listing worker tick failed')
    } finally {
      running = false
    }
  }

  function eligibleForExtraction(s) {
    if (!s.ready_for_extraction_at) return false
    const ready = s.ready_for_extraction_at <= new Date().toISOString()
    if (!ready) return false
    if (s.state === SessionState.COLLECTING) return true
    if (s.state === SessionState.ERROR && s.retry_count < MAX_RETRIES && s.next_retry_at && s.next_retry_at <= new Date().toISOString()) {
      return true
    }
    return false
  }

  async function processIntakeWindows() {
    const sessions = await findAllModule(Collections.SESSIONS, eligibleForExtraction)

    if (sessions.length) {
      logger.debug({ count: sessions.length }, 'WhatsApp listing worker processing intake windows')
    }

    for (const session of sessions) {
      try {
        await pipeline.runExtraction(session.id)
      } catch (err) {
        logger.error({ sessionId: session.id, err: err.message || String(err) }, 'runExtraction failed')
      }
    }
  }

  async function processRetries() {
    // Pick up sessions that the pipeline marked ERROR and scheduled for retry,
    // but whose retry_count already reached the max. Move those to the dead-letter queue.
    const sessions = await findAllModule(
      Collections.SESSIONS,
      (s) => s.state === SessionState.ERROR && s.retry_count >= MAX_RETRIES && !s.dead_lettered,
    )

    for (const session of sessions) {
      try {
        await moveToDeadLetter(session, 'max_retries_exceeded')
      } catch (err) {
        logger.error({ sessionId: session.id, err: err.message || String(err) }, 'dead letter move failed')
      }
    }
  }

  async function moveToDeadLetter(session, reason) {
    await insertModule(Collections.DEAD_LETTERS, {
      id: uuidv4(),
      session_id: session.id,
      agent_id: session.agent_id,
      phone_number: session.phone_number,
      reason,
      last_error: session.last_error || null,
      retry_count: session.retry_count,
      payload: { ...session },
      created_at: new Date().toISOString(),
    })
    await updateModule(
      Collections.SESSIONS,
      (s) => s.id === session.id,
      (s) => ({ ...s, dead_lettered: true, updated_at: new Date().toISOString() }),
    )
    if (session.draft_id) {
      const draft = await findOneModule(Collections.DRAFTS, (d) => d.id === session.draft_id)
      if (draft) {
        await updateModule(
          Collections.DRAFTS,
          (d) => d.id === draft.id,
          (d) => ({ ...d, status: DraftStatus.ERROR, error: reason, updated_at: new Date().toISOString() }),
        )
      }
    }
    try {
      const { sendWhatsAppText } = await import('../../../whatsapp.js')
      await sendWhatsAppText(session.phone_number, 'Sorry, I could not process your listing after several attempts. Please check your dashboard or try again.')
    } catch (err) {
      logger.warn({ err: err.message }, 'failed to send dead-letter notification')
    }
  }

  async function processApprovalTimeouts() {
    // Auto-discard drafts that have been awaiting approval for longer than the session TTL.
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000
    const cutoff = new Date(Date.now() - ttlMs).toISOString()
    const sessions = await findAllModule(Collections.SESSIONS, (s) =>
      s.state === SessionState.AWAITING_APPROVAL &&
      s.updated_at &&
      s.updated_at < cutoff,
    )

    for (const session of sessions) {
      try {
        await pipeline.discardDraft(session.id)
        const { sendWhatsAppText } = await import('../../../whatsapp.js')
        await sendWhatsAppText(session.phone_number, 'Your listing draft timed out and was discarded. Send new details to start again.')
      } catch (err) {
        logger.error({ sessionId: session.id, err: err.message || String(err) }, 'approval timeout discard failed')
      }
    }
  }

  async function pruneDedupeRecords() {
    const ttlMs = config.dedupeTtlHours * 60 * 60 * 1000
    const cutoff = new Date(Date.now() - ttlMs).toISOString()
    const removed = await removeModule(Collections.PROCESSED_MESSAGES, (m) => m.processed_at && m.processed_at < cutoff)
    if (removed > 0) {
      logger.debug({ removed }, 'pruned old WhatsApp listing processed messages')
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(() => {
      tick().catch(() => {})
    }, config.workerIntervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    logger.info({ intervalMs: config.workerIntervalMs }, 'WhatsApp listing worker started')
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    start,
    stop,
    tick,
    isRunning,
  }
}
