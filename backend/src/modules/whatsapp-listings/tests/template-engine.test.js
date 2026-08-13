import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { createTemplateEngine } from '../infrastructure/templates/engine.js'
import sharp from 'sharp'

describe('WhatsApp Listing template engine', () => {
  const testDir = join(process.cwd(), 'backend', 'src', 'modules', 'whatsapp-listings', 'tests', '.fixtures')
  const storageDir = join(testDir, 'storage')
  let inputImagePath

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true })
    inputImagePath = join(testDir, 'sample-property.jpg')
    // Create a 1200x800 sample image.
    const buffer = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer()
    await writeFile(inputImagePath, buffer)
  })

  afterAll(async () => {
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {}
  })

  it('generates all three sizes for the modern variant', async () => {
    const engine = createTemplateEngine({
      config: { storagePath: storageDir, brandMark: 'TEST' },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, child: () => ({ debug: () => {} }) },
    })

    const property = {
      id: 'test-property-id',
      title: 'Test Apartment',
      price: 250000,
      price_unit: 'USD',
      city: 'Beirut',
      neighborhood: 'Hamra',
      location: 'Hamra, Beirut',
    }

    const result = await engine.generate({
      property,
      inputImagePath,
      variant: 'modern',
      outputDir: storageDir,
      version: 1,
    })

    expect(result.variant).toBe('modern')
    expect(result.paths['1080x1080']).toBeTruthy()
    expect(result.paths['1080x1920']).toBeTruthy()
    expect(result.paths['1200x675']).toBeTruthy()

    for (const path of Object.values(result.paths)) {
      await expect(access(path)).resolves.toBeUndefined()
    }
  })

  it('selects the luxe variant for luxury signals', () => {
    const engine = createTemplateEngine({
      config: { storagePath: storageDir },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, child: () => ({ debug: () => {} }) },
    })
    expect(engine.selectVariant('Luxury penthouse with marble finishes and sea view')).toBe('luxe')
  })

  it('selects the urgent variant for urgency signals', () => {
    const engine = createTemplateEngine({
      config: { storagePath: storageDir },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, child: () => ({ debug: () => {} }) },
    })
    expect(engine.selectVariant('Price drop! Must sell ASAP! Motivated seller')).toBe('urgent')
  })
})
