import { describe, expect, it } from 'vitest'
import { sortRateCards } from './RateCardsAdminPage'
import { groupActionKey, groupRates } from './RateCardEditor'
import type { CoreRateCard } from '@/types/commercialPricing'

function card(id: string, version: number): CoreRateCard {
  return {
    id,
    version,
    name: `v${version}`,
    description: null,
    currency: 'USD',
    cast_value_minor: 10,
    rates: {},
    is_active: false,
    activated_at: null,
    deactivated_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('sortRateCards', () => {
  it('places the active card first regardless of version', () => {
    const cards = [card('a', 3), card('b', 5), card('c', 1)]
    const sorted = sortRateCards(cards, 'c')
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts remaining cards by version DESC when there is no active card', () => {
    const cards = [card('a', 3), card('b', 5), card('c', 1)]
    const sorted = sortRateCards(cards, null)
    expect(sorted.map((c) => c.version)).toEqual([5, 3, 1])
  })

  it('leaves the input array unmutated', () => {
    const cards = [card('a', 3), card('b', 5)]
    const before = cards.map((c) => c.id).join(',')
    sortRateCards(cards, 'b')
    expect(cards.map((c) => c.id).join(',')).toBe(before)
  })
})

describe('groupActionKey', () => {
  it('recognises every known group prefix', () => {
    expect(groupActionKey('publish.meta.facebook')).toBe('publish')
    expect(groupActionKey('message.out.whatsapp.utility')).toBe('message.out')
    expect(groupActionKey('message.in.whatsapp')).toBe('message.in')
    expect(groupActionKey('ai.chat.turn')).toBe('ai')
    expect(groupActionKey('render.template.premium')).toBe('render')
    expect(groupActionKey('score.property.fresh')).toBe('score')
    expect(groupActionKey('avm.report')).toBe('avm')
    expect(groupActionKey('staging.ai_image')).toBe('staging')
    expect(groupActionKey('webhook.received')).toBe('webhook')
    expect(groupActionKey('listing.active_day')).toBe('listing')
    expect(groupActionKey('storage.gb_month')).toBe('storage')
    expect(groupActionKey('seat.agent')).toBe('seat')
    expect(groupActionKey('support.ticket')).toBe('support')
  })

  it('falls back to first dot-segment for unknown prefixes', () => {
    expect(groupActionKey('mystery.new.action')).toBe('mystery')
    expect(groupActionKey('single')).toBe('single')
  })
})

describe('groupRates', () => {
  it('buckets by prefix and sorts each bucket alphabetically', () => {
    const rates = {
      'publish.x.plain': 4,
      'publish.meta.facebook': 3,
      'ai.chat.turn': 1,
      'avm.report': 15,
      'publish.x.link': 8,
    }
    const grouped = groupRates(rates)
    expect(Object.keys(grouped).sort()).toEqual(['ai', 'avm', 'publish'])
    expect(grouped.publish.map(([k]) => k)).toEqual([
      'publish.meta.facebook',
      'publish.x.link',
      'publish.x.plain',
    ])
    expect(grouped.ai).toHaveLength(1)
    expect(grouped.avm).toHaveLength(1)
  })
})
