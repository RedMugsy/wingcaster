/**
 * Fast suite — cutover mode resolver (no Postgres).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCutoverModeFromParts } from './mode.js'

describe('resolveCutoverModeFromParts', () => {
  const prev = process.env.FIN_CUTOVER_MODE_GLOBAL

  afterEach(() => {
    if (prev === undefined) delete process.env.FIN_CUTOVER_MODE_GLOBAL
    else process.env.FIN_CUTOVER_MODE_GLOBAL = prev
  })

  it('returns FIN_ONLY when global env is FIN_ONLY', () => {
    expect(resolveCutoverModeFromParts({
      globalMode: 'FIN_ONLY',
      allowlistMode: 'DUAL',
    })).toBe('FIN_ONLY')
  })

  it('returns DUAL when allowlist says DUAL and global is not FIN_ONLY', () => {
    expect(resolveCutoverModeFromParts({
      globalMode: 'OFF',
      allowlistMode: 'DUAL',
    })).toBe('DUAL')
    expect(resolveCutoverModeFromParts({
      globalMode: null,
      allowlistMode: 'dual',
    })).toBe('DUAL')
  })

  it('returns OFF by default', () => {
    delete process.env.FIN_CUTOVER_MODE_GLOBAL
    expect(resolveCutoverModeFromParts({})).toBe('OFF')
    expect(resolveCutoverModeFromParts({
      globalMode: 'OFF',
      allowlistMode: 'OFF',
    })).toBe('OFF')
    expect(resolveCutoverModeFromParts({
      globalMode: 'DUAL',
      allowlistMode: null,
    })).toBe('OFF')
  })
})
