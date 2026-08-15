import { describe, it, expect, vi } from 'vitest'
import {
  assertActiveCurrencyProvidersConfigured,
  createCurrencyProvider,
  listCurrencyProviderNames,
} from '../application/currency-providers.js'

describe('Currency Providers', () => {
  it('rejects an active Sayrafa source at boot without credentials', () => {
    expect(() => assertActiveCurrencyProvidersConfigured([
      { provider: 'sayrafa', enabled: true },
    ], {})).toThrow('Active Sayrafa provider requires SAYRAFA_API_URL and SAYRAFA_API_KEY to be set')
  })

  it('lists all supported provider names', () => {
    expect(listCurrencyProviderNames()).toEqual(['manual', 'lira_rate', 'sayrafa', 'custom'])
  })

  it('manual provider returns null', async () => {
    const provider = createCurrencyProvider('manual')
    const result = await provider.fetchRate('LBP', 'USD')
    expect(result).toBeNull()
  })

  it('lira_rate provider returns null for non-LBP/USD pairs', async () => {
    const provider = createCurrencyProvider('lira_rate')
    const result = await provider.fetchRate('EUR', 'USD')
    expect(result).toBeNull()
  })

  it('lira_rate provider parses sell rate from API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ rate: { buy: '89000', sell: '89500' } })),
    })

    const provider = createCurrencyProvider('lira_rate')
    const result = await provider.fetchRate('LBP', 'USD')
    expect(result).toEqual({ rate: 89500, source: 'lira_rate' })
  })

  it('lira_rate provider falls back to buy rate when sell missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ rate: { buy: '90000' } })),
    })

    const provider = createCurrencyProvider('lira_rate')
    const result = await provider.fetchRate('LBP', 'USD')
    expect(result).toEqual({ rate: 90000, source: 'lira_rate' })
  })

  it('lira_rate provider throws on invalid response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ rate: null })),
    })

    const provider = createCurrencyProvider('lira_rate')
    await expect(provider.fetchRate('LBP', 'USD')).rejects.toThrow('Invalid LiraRate response')
  })

  it('sayrafa provider throws when credentials missing', async () => {
    delete process.env.SAYRAFA_API_URL
    delete process.env.SAYRAFA_API_KEY

    const provider = createCurrencyProvider('sayrafa')
    await expect(provider.fetchRate('LBP', 'USD')).rejects.toThrow('SAYRAFA_API_URL and SAYRAFA_API_KEY must be configured')
  })

  it('custom provider extracts rate from configured jsonPath', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ data: { conversion: { lbp: 89000 } } })),
    })

    const provider = createCurrencyProvider('custom', { url: 'https://example.com/rate', jsonPath: 'data.conversion.lbp' })
    const result = await provider.fetchRate('LBP', 'USD')
    expect(result).toEqual({ rate: 89000, source: 'custom' })
  })

  it('custom provider throws when url missing', async () => {
    const provider = createCurrencyProvider('custom', {})
    await expect(provider.fetchRate('LBP', 'USD')).rejects.toThrow('Custom provider missing url')
  })

  it('unknown provider throws', () => {
    expect(() => createCurrencyProvider('unknown')).toThrow('Unknown currency rate provider')
  })
})
