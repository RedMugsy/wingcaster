import { promises as dns } from 'node:dns'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import sharp from 'sharp'
import { fetchImageAsBase64 } from './shared.js'

const server = setupServer()
let jpeg
let png

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#d4af37' } }).jpeg().toBuffer()
  png = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
  delete process.env.IMAGE_FETCH_MAX_BYTES
  delete process.env.IMAGE_FETCH_TIMEOUT_MS
})

afterAll(() => server.close())

function allowPublicDns() {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '203.0.113.10', family: 4 }])
}

function imageResponse(bytes, headers = {}) {
  return new HttpResponse(bytes, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.byteLength),
      ...headers,
    },
  })
}

describe('fetchImageAsBase64 SSRF and file protections', () => {
  it('rejects file URLs', async () => {
    await expect(fetchImageAsBase64('file:///etc/passwd')).rejects.toThrow('Only http(s) or data: image URLs are accepted')
  })

  it('rejects absolute filesystem paths', async () => {
    await expect(fetchImageAsBase64('C:\\Windows\\win.ini')).rejects.toThrow('Only http(s) or data: image URLs are accepted')
  })

  it.each([
    'http://127.0.0.1/x.jpg',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/x.jpg',
    'http://[::ffff:10.0.0.1]/x.jpg',
    'http://metadata.google.internal/x.jpg',
  ])('blocks private, loopback, mapped, and metadata destination %s', async (url) => {
    await expect(fetchImageAsBase64(url)).rejects.toThrow('blocked network address')
  })

  it('revalidates a redirect destination and blocks a private target', async () => {
    allowPublicDns()
    server.use(http.get('https://images.example/start', () => new HttpResponse(null, {
      status: 302,
      headers: { Location: 'http://10.0.0.1/x.jpg' },
    })))
    await expect(fetchImageAsBase64('https://images.example/start')).rejects.toThrow('blocked network address')
  })
})

describe('fetchImageAsBase64 response validation', () => {
  it('rejects an excessive Content-Length', async () => {
    allowPublicDns()
    server.use(http.get('https://images.example/large.jpg', () => imageResponse(jpeg, { 'Content-Length': '999999999' })))
    await expect(fetchImageAsBase64('https://images.example/large.jpg')).rejects.toThrow('exceeds')
  })

  it('rejects a non-image Content-Type', async () => {
    allowPublicDns()
    server.use(http.get('https://images.example/html', () => imageResponse(Buffer.from('<html></html>'), { 'Content-Type': 'text/html' })))
    await expect(fetchImageAsBase64('https://images.example/html')).rejects.toThrow('Content-Type')
  })

  it('rejects a truncated response whose body is shorter than declared', async () => {
    allowPublicDns()
    const bytes = Buffer.alloc(100)
    server.use(http.get('https://images.example/truncated.jpg', () => imageResponse(bytes, { 'Content-Length': '1000' })))
    await expect(fetchImageAsBase64('https://images.example/truncated.jpg')).rejects.toThrow('does not match Content-Length')
  })

  it('accepts and validates a base64 PNG data URI', async () => {
    const encoded = png.toString('base64')
    await expect(fetchImageAsBase64(`data:image/png;base64,${encoded}`, 'image/jpeg')).resolves.toEqual({
      mimeType: 'image/png', data: encoded,
    })
  })

  it('round-trips a valid JPEG and trusts sharp for its MIME type', async () => {
    allowPublicDns()
    server.use(http.get('https://images.example/photo.bin', () => imageResponse(jpeg, { 'Content-Type': 'image/untrusted' })))
    const result = await fetchImageAsBase64('https://images.example/photo.bin', 'image/png')
    expect(result).toEqual({ mimeType: 'image/jpeg', data: jpeg.toString('base64') })
    expect((await sharp(Buffer.from(result.data, 'base64')).metadata()).format).toBe('jpeg')
  })
})
