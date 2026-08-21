import { accessSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { makeOpsApp } from './http-support.js'

const vendorFile = join(dirname(fileURLToPath(import.meta.url)), 'vendors', 'routes.js')
let stage11 = false
try {
  accessSync(vendorFile)
  stage11 = true
} catch {
  stage11 = false
}

const suite = stage11 ? finPostgresSuite : (name, _opts, fn) => {
  describe(`${name} (Stage 11 not merged — read stub only)`, () => {
    it('placeholder so the file still lists in the pg summary', () => {
      expect(stage11).toBe(false)
    })
  })
  finPostgresSuite(name, {}, fn)
}

suite('admin/routes-vendors', {}, ({ url }) => {
  it('GET /api/admin/fin/vendors is registered', async () => {
    const { app } = await makeOpsApp(url())
    const res = await request(app).get('/api/admin/fin/vendors')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.vendors)).toBe(true)
    if (!stage11) expect(res.body.stage11).toBe(false)
  })
})
