/**
 * Session management for the WhatsApp Listing intake state machine.
 */

import { v4 as uuidv4 } from 'uuid'
import { Collections, findOneModule, findAllModule, insertModule, updateModule, removeModule } from './db.js'
import { transition as stateTransition } from '../domain/state.js'
import { SessionState, MessageDirection, MessageType, Intent, LocationSource } from '../domain/types.js'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeSession(session) {
  if (!session) return session
  return {
    ...session,
    messages: asArray(session.messages),
    media: asArray(session.media),
    location_pins: asArray(session.location_pins),
  }
}

export function createSessionStore({ config, logger }) {
  async function getOrCreateSession({ agentId, phoneNumber }) {
    let session = await findOneModule(Collections.SESSIONS, (s) => s.agent_id === agentId && s.phone_number === phoneNumber && !isExpired(s))
    if (!session) {
      session = await insertModule(Collections.SESSIONS, {
        id: uuidv4(),
        agent_id: agentId,
        phone_number: phoneNumber,
        state: SessionState.IDLE,
        intent: Intent.CREATE,
        matched_listing_id: null,
        messages: [],
        media: [],
        location_pins: [],
        location_source: LocationSource.UNKNOWN,
        address_description: null,
        extracted_property: null,
        selected_variant: null,
        generated_thumbnails: null,
        generated_captions: null,
        draft_id: null,
        retry_count: 0,
        next_retry_at: null,
        last_error: null,
        last_activity_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
    return normalizeSession(session)
  }

  async function getById(sessionId) {
    return normalizeSession(await findOneModule(Collections.SESSIONS, (s) => s.id === sessionId))
  }

  async function getByAgentPhone(agentId, phoneNumber) {
    return normalizeSession(await findOneModule(Collections.SESSIONS, (s) => s.agent_id === agentId && s.phone_number === phoneNumber))
  }

  async function addMessage(sessionId, message) {
    return await updateModule(
      Collections.SESSIONS,
      (s) => s.id === sessionId,
      (s) => ({
        ...s,
        messages: [...asArray(s.messages), { id: uuidv4(), ...message, created_at: new Date().toISOString() }],
        last_interactive_id: message.interactive_id || s.last_interactive_id || null,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    )
  }

  async function addMedia(sessionId, media) {
    return await updateModule(
      Collections.SESSIONS,
      (s) => s.id === sessionId,
      (s) => ({
        ...s,
        media: [...asArray(s.media), { id: uuidv4(), ...media, created_at: new Date().toISOString() }],
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    )
  }

  async function transition(sessionId, toState) {
    return await updateModule(
      Collections.SESSIONS,
      (s) => s.id === sessionId,
      (s) => stateTransition({ ...s, updated_at: new Date().toISOString() }, toState),
    )
  }

  async function updateSession(sessionId, patch) {
    return await updateModule(
      Collections.SESSIONS,
      (s) => s.id === sessionId,
      (s) => ({
        ...s,
        ...patch,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    )
  }

  function isExpired(session) {
    const ttlMs = config.sessionTtlHours * 60 * 60 * 1000
    const last = new Date(session.last_activity_at || session.updated_at || session.created_at).getTime()
    return Date.now() - last > ttlMs
  }

  async function pruneExpired() {
    const all = await findAllModule(Collections.SESSIONS, () => true)
    let removed = 0
    for (const session of all) {
      if (isExpired(session)) {
        await removeModule(Collections.SESSIONS, (s) => s.id === session.id)
        removed += 1
      }
    }
    return removed
  }

  return {
    getOrCreateSession,
    getById,
    getByAgentPhone,
    addMessage,
    addMedia,
    transition,
    updateSession,
    pruneExpired,
  }
}

export { MessageDirection, MessageType }
