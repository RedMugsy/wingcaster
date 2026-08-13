/**
 * Module environment configuration.
 *
 * All module env vars are prefixed with WHATSAPP_LISTINGS_.
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function getConfig() {
  const env = (key, fallback = '') => process.env[key] ?? fallback

  const storagePath = env('WHATSAPP_LISTINGS_STORAGE_PATH', join(__dirname, '../../../uploads/whatsapp-listings'))
  const aiProvider = env('WHATSAPP_LISTINGS_AI_PROVIDER', 'gemini').toLowerCase()

  return {
    enabled: env('WHATSAPP_LISTINGS_ENABLED', 'true') === 'true',
    storagePath,
    aiProvider,
    fallbackAiProviders: env('WHATSAPP_LISTINGS_FALLBACK_AI_PROVIDERS', 'gemini,openai').split(',').map((s) => s.trim()).filter(Boolean),
    intakeWindowMs: Math.max(1000, Number(env('WHATSAPP_LISTINGS_INTAKE_WINDOW_MS', 120000))),
    maxMediaPerDraft: Math.max(1, Math.min(50, Number(env('WHATSAPP_LISTINGS_MAX_MEDIA_PER_DRAFT', 15)))),
    maxMediaSizeBytes: Math.max(1, Number(env('WHATSAPP_LISTINGS_MAX_MEDIA_SIZE_BYTES', 12 * 1024 * 1024))),
    instagramRealPublishing: env('WHATSAPP_LISTINGS_INSTAGRAM_REAL_PUBLISHING', 'true') === 'true',
    workerIntervalMs: Math.max(5000, Number(env('WHATSAPP_LISTINGS_WORKER_INTERVAL_MS', 60000))),
    workerBatchSize: Math.max(1, Math.min(100, Number(env('WHATSAPP_LISTINGS_WORKER_BATCH_SIZE', 20)))),
    dedupeTtlHours: Math.max(1, Math.min(168, Number(env('WHATSAPP_LISTINGS_DEDUPE_TTL_HOURS', 24)))),
    sessionTtlHours: Math.max(1, Math.min(168, Number(env('WHATSAPP_LISTINGS_SESSION_TTL_HOURS', 24)))),
    credits: {
      extractionCost: Number(env('WHATSAPP_LISTINGS_EXTRACTION_CREDIT_COST', 0.05)),
      thumbnailCost: Number(env('WHATSAPP_LISTINGS_THUMBNAIL_CREDIT_COST', 0.05)),
      captionCost: Number(env('WHATSAPP_LISTINGS_CAPTION_CREDIT_COST', 0.02)),
      socialPublishCost: Number(env('WHATSAPP_LISTINGS_SOCIAL_PUBLISH_CREDIT_COST', 0.03)),
    },
  }
}
