import { describe, expect, it } from 'vitest'
import { resolveServerPort } from './lib/port.js'

describe('resolveServerPort', () => {
  it('prefers an explicit CLI port argument', async () => {
    await expect(resolveServerPort(['node', 'server.js', '--port', '4000'], {}, { isPortAvailable: async (port) => port === 4000 })).resolves.toBe(4000)
  })

  it('uses the PORT environment variable when no CLI override is provided', async () => {
    await expect(resolveServerPort(['node', 'server.js'], { PORT: '5000' }, { isPortAvailable: async (port) => port === 5000 })).resolves.toBe(5000)
  })

  it('falls back to the next available port when the preferred one is busy', async () => {
    await expect(resolveServerPort(['node', 'server.js', '--port', '4000'], {}, { isPortAvailable: async (port) => port === 4001 })).resolves.toBe(4001)
  })

  it('falls back to the default backend port', async () => {
    await expect(resolveServerPort(['node', 'server.js'], {}, { isPortAvailable: async () => true })).resolves.toBe(3001)
  })
})
