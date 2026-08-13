/**
 * Media storage helpers for the WhatsApp Listing module.
 *
 * Downloads media from WhatsApp Cloud API and stores it in the platform's
 * existing uploads directory.
 */

import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, extname, dirname } from 'path'
import { getWhatsAppConfig } from '../../../whatsapp.js'

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export function createStorage({ config, logger }) {
  async function downloadMedia(mediaId) {
    const cfg = getWhatsAppConfig()
    if (!cfg.accessToken) throw new Error('META_ACCESS_TOKEN not configured')

    // Step 1: resolve media URL
    const metaUrl = `${GRAPH_BASE}/${mediaId}?access_token=${cfg.accessToken}`
    const metaRes = await fetch(metaUrl)
    const metaData = await metaRes.json().catch(() => ({}))
    if (!metaRes.ok || !metaData.url) {
      throw new Error(`WhatsApp media metadata failed (${metaRes.status}): ${metaData?.error?.message || JSON.stringify(metaData).slice(0, 200)}`)
    }

    // Step 2: download binary
    const binaryRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
    })
    if (!binaryRes.ok) {
      throw new Error(`WhatsApp media download failed (${binaryRes.status})`)
    }
    const buffer = Buffer.from(await binaryRes.arrayBuffer())
    const mimeType = metaData.mime_type || binaryRes.headers.get('content-type') || 'application/octet-stream'
    const ext = extensionFromMime(mimeType) || '.bin'

    const now = Date.now()
    const filename = `wa-${mediaId}-${now}${ext}`
    const relativeDir = 'whatsapp-listings/media'
    const absoluteDir = join(config.storagePath, relativeDir)
    if (!existsSync(absoluteDir)) {
      await mkdir(absoluteDir, { recursive: true })
    }
    const absolutePath = join(absoluteDir, filename)
    await writeFile(absolutePath, buffer)

    const publicUrl = `${await getPublicApiBase()}/uploads/whatsapp-listings/media/${filename}`
    return {
      mediaId,
      filename,
      mimeType,
      size: buffer.length,
      localPath: absolutePath,
      relativePath: `${relativeDir}/${filename}`,
      publicUrl,
    }
  }

  async function ensureDirForPath(filePath) {
    const dir = dirname(filePath)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  }

  return {
    downloadMedia,
    ensureDirForPath,
  }
}

function extensionFromMime(mimeType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'application/pdf': '.pdf',
  }
  return map[mimeType] || extname(mimeType) || '.bin'
}

async function getPublicApiBase() {
  return process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3001/api'
}
