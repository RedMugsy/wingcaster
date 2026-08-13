/**
 * AI credit service for the WhatsApp Listing module.
 *
 * Supports both agent and agency scopes. Credits are reserved on intake,
 * deducted after actual work (recorded as 'consumption'), and released on failure.
 *
 * Transaction types: top_up, consumption, refund, adjustment.
 */

import { Collections, findOneModule, findAllModule, insertModule, updateModule } from '../infrastructure/db.js'
import { CreditScope, CreditType } from '../domain/types.js'
import { v4 as uuidv4 } from 'uuid'

function makeBalanceId(scope, scopeId) {
  return `${scope}:${scopeId}`
}

export function createCreditService({ adapter }) {
  async function getOrCreateBalance(scope, scopeId) {
    const balanceId = makeBalanceId(scope, scopeId)
    let balance = await findOneModule(Collections.AI_CREDIT_BALANCES, (b) => b.scope === scope && b.scope_id === scopeId)
    if (!balance) {
      balance = await insertModule(Collections.AI_CREDIT_BALANCES, {
        id: balanceId,
        scope,
        scope_id: scopeId,
        credits_remaining: 0,
        credits_reserved: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
    return balance
  }

  async function recordTransaction({ scope, scopeId, type, amount, description, relatedDraftId }) {
    return await insertModule(Collections.AI_CREDIT_TRANSACTIONS, {
      id: uuidv4(),
      scope,
      scope_id: scopeId,
      type,
      amount: Number(amount),
      description,
      related_draft_id: relatedDraftId || null,
      created_at: new Date().toISOString(),
    })
  }

  async function topUp(scope, scopeId, amount, { paymentIntentId, description } = {}) {
    const amountNum = Math.max(0, Number(amount))
    if (!amountNum) throw new Error('Top-up amount must be positive')

    const balance = await getOrCreateBalance(scope, scopeId)
    const nextRemaining = Number(balance.credits_remaining) + amountNum
    await updateModule(
      Collections.AI_CREDIT_BALANCES,
      (b) => b.id === balance.id,
      (b) => ({
        ...b,
        credits_remaining: nextRemaining,
        updated_at: new Date().toISOString(),
      }),
    )
    await recordTransaction({
      scope,
      scopeId,
      type: CreditType.TOP_UP,
      amount: amountNum,
      description: description || `Top-up${paymentIntentId ? ` (payment_intent: ${paymentIntentId})` : ''}`,
    })
    return await getOrCreateBalance(scope, scopeId)
  }

  async function reserve(scope, scopeId, amount, { description, relatedDraftId } = {}) {
    const amountNum = Math.max(0, Number(amount))
    const balance = await getOrCreateBalance(scope, scopeId)
    const available = Number(balance.credits_remaining) - Number(balance.credits_reserved)
    if (available < amountNum) {
      return { ok: false, error: 'Insufficient credits', balance }
    }
    await updateModule(
      Collections.AI_CREDIT_BALANCES,
      (b) => b.id === balance.id,
      (b) => ({
        ...b,
        credits_reserved: Number(b.credits_reserved) + amountNum,
        updated_at: new Date().toISOString(),
      }),
    )
    // Reservations are not recorded as transactions; only consumption/refund/adjustment are.
    return { ok: true, balance: await getOrCreateBalance(scope, scopeId) }
  }

  async function consume(scope, scopeId, amount, { description, relatedDraftId } = {}) {
    const amountNum = Math.max(0, Number(amount))
    const balance = await getOrCreateBalance(scope, scopeId)
    const reserved = Math.min(Number(balance.credits_reserved), amountNum)
    const remaining = Math.max(0, Number(balance.credits_remaining) - amountNum)
    const reservedAfter = Math.max(0, Number(balance.credits_reserved) - reserved)

    await updateModule(
      Collections.AI_CREDIT_BALANCES,
      (b) => b.id === balance.id,
      (b) => ({
        ...b,
        credits_remaining: remaining,
        credits_reserved: reservedAfter,
        updated_at: new Date().toISOString(),
      }),
    )
    await recordTransaction({
      scope,
      scopeId,
      type: CreditType.CONSUMPTION,
      amount: amountNum,
      description,
      relatedDraftId,
    })
    return await getOrCreateBalance(scope, scopeId)
  }

  async function release(scope, scopeId, amount, { description, relatedDraftId } = {}) {
    const amountNum = Math.max(0, Number(amount))
    const balance = await getOrCreateBalance(scope, scopeId)
    const reservedAfter = Math.max(0, Number(balance.credits_reserved) - amountNum)
    await updateModule(
      Collections.AI_CREDIT_BALANCES,
      (b) => b.id === balance.id,
      (b) => ({
        ...b,
        credits_reserved: reservedAfter,
        updated_at: new Date().toISOString(),
      }),
    )
    await recordTransaction({
      scope,
      scopeId,
      type: CreditType.ADJUSTMENT,
      amount: -amountNum,
      description: description || 'Released reserved credits',
      relatedDraftId,
    })
    return await getOrCreateBalance(scope, scopeId)
  }

  async function refund(scope, scopeId, amount, { description, relatedDraftId } = {}) {
    const amountNum = Math.max(0, Number(amount))
    const balance = await getOrCreateBalance(scope, scopeId)
    await updateModule(
      Collections.AI_CREDIT_BALANCES,
      (b) => b.id === balance.id,
      (b) => ({
        ...b,
        credits_remaining: Number(b.credits_remaining) + amountNum,
        updated_at: new Date().toISOString(),
      }),
    )
    await recordTransaction({
      scope,
      scopeId,
      type: CreditType.REFUND,
      amount: amountNum,
      description,
      relatedDraftId,
    })
    return await getOrCreateBalance(scope, scopeId)
  }

  async function balance(scope, scopeId) {
    return await getOrCreateBalance(scope, scopeId)
  }

  async function transactions(scope, scopeId, { limit = 100 } = {}) {
    const all = await findAllModule(Collections.AI_CREDIT_TRANSACTIONS, (t) => t.scope === scope && t.scope_id === scopeId)
    return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit)
  }

  async function allocateAgencyToAgent(agencyId, agentId, amount, { description } = {}) {
    const amountNum = Math.max(0, Number(amount))
    const agencyBalance = await getOrCreateBalance(CreditScope.AGENCY, agencyId)
    const available = Number(agencyBalance.credits_remaining) - Number(agencyBalance.credits_reserved)
    if (available < amountNum) {
      return { ok: false, error: 'Insufficient agency credits' }
    }
    // Transfer from agency to agent
    await consume(CreditScope.AGENCY, agencyId, amountNum, {
      description: description || `Allocated to agent ${agentId}`,
    })
    await topUp(CreditScope.AGENT, agentId, amountNum, {
      description: description || `Allocated from agency ${agencyId}`,
    })
    return { ok: true, agencyBalance: await balance(CreditScope.AGENCY, agencyId), agentBalance: await balance(CreditScope.AGENT, agentId) }
  }

  return {
    topUp,
    reserve,
    consume,
    release,
    refund,
    balance,
    transactions,
    allocateAgencyToAgent,
  }
}
