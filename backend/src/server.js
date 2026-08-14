import 'dotenv/config'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { randomBytes, createHash } from 'crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import { loadDb, getDb, findAll, findOne, insert, remove, update, transaction } from './db.js'
import { getPool } from './persistence/postgres-adapter.js'
import { seedData } from './seed.js'
import { signToken, authMiddleware } from './auth.js'
import {
  createAgentAccount,
  findAgentForUser,
  findUserByEmail,
  findUserById,
  updateUser,
  updatePlatformRole,
} from './identity.js'
import {
  buildDefaultNotificationPrefs,
  normalizeNotificationPrefs,
  serializeNotificationPrefs,
} from './notification-preferences.js'
import {
  addAgencyMembership,
  createAgencyWithOwner,
  getAgencyMembership,
  listUserAgencyMemberships,
  updateAgencyMembership,
} from './tenant-authorization.js'
import logger from './lib/logger.js'
import { createPropertyWithCanonical } from './lib/property-write.js'
import { escapeXml } from './lib/xml.js'
import { sendOtp } from './lib/otp.js'
import { resolveServerPort } from './lib/port.js'
import {
  validate,
  validateQuery,
  registerSchema,
  loginSchema,
  passwordForgotSchema,
  passwordResetSchema,
  passwordChangeSchema,
  accountRecoveryRequestSchema,
  accountRecoveryReviewSchema,
  accountRecoveryCompleteSchema,
  otpSendSchema,
  otpVerifySchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  inquirySchema,
  inquiryUpdateSchema,
  viewingCreateSchema,
  viewingUpdateSchema,
  savedSearchCreateSchema,
  savedSearchUpdateSchema,
  agencyCreateSchema,
  agencyApplySchema,
  propertyQuerySchema,
  notificationPrefsUpdateSchema,
  notificationQuerySchema,
  inquiryQuerySchema,
  taskCreateSchema,
  taskUpdateSchema,
  taskQuerySchema,
  opportunityCreateSchema,
  opportunityUpdateSchema,
  contactNoteSchema,
  messageTemplateCreateSchema,
  messageTemplateUpdateSchema,
  messageTemplateRenderSchema,
} from './lib/validation.js'
import {
  isWhatsAppConfigured,
  getWhatsAppConfig,
  getWhatsAppHealth,
  buildListingChatCard,
  sendListingToWhatsApp,
  sendWhatsAppText,
  parseIncomingWhatsAppWebhook,
} from './whatsapp.js'
import {
  isSMSEnabled,
  parseIncomingSMSWebhook,
  parseSMSStatusWebhook,
} from './lib/notifications/sms.js'
import {
  isEmailEnabled,
  parseIncomingEmailWebhook,
  parseEmailStatusWebhook,
} from './lib/notifications/email.js'
import {
  isInstagramEnabled,
  parseIncomingInstagramCommentWebhook,
  parseIncomingInstagramDMWebhook,
  publishInstagramFeed,
  publishInstagramCarousel,
  publishInstagramReel,
  publishInstagramStory,
} from './lib/notifications/instagram.js'
import {
  isTikTokEnabled,
  parseIncomingTikTokWebhook,
  publishTikTokPhoto,
  publishTikTokVideo,
} from './lib/notifications/tiktok.js'
import {
  isFacebookEnabled,
  parseIncomingFacebookWebhook,
  publishFacebookPagePost,
  publishFacebookPagePhoto,
} from './lib/notifications/facebook.js'
import {
  isLinkedInEnabled,
  publishLinkedInPost,
  fetchLinkedInInsights,
} from './lib/notifications/linkedin.js'
import { fetchInstagramInsights } from './lib/notifications/instagram.js'
import { fetchFacebookInsights } from './lib/notifications/facebook.js'
import { fetchXInsights } from './lib/notifications/x.js'
import { fetchTikTokInsights } from './lib/notifications/tiktok.js'
import {
  encryptSecret,
  PLATFORM_INTEGRATION_MODEL,
  PLATFORM_CONNECTION_FIELDS,
  resolveConnectionCredentials,
} from './lib/credentials.js'
import {
  createModule as createWhatsAppListingsModule,
  createDefaultPlatformAdapter as createWhatsAppPlatformAdapter,
  MODULE_NAME as WHATSAPP_LISTINGS_MODULE_NAME,
} from './modules/whatsapp-listings/index.js'
import {
  createModule as createAreaIntelligenceModule,
} from './modules/area-intelligence/index.js'
import {
  createModule as createMarketPricingModule,
} from './modules/market-pricing/index.js'
import {
  createModule as createListingsAiModule,
} from './modules/listings-ai/index.js'
import {
  createModule as createSocialCardsModule,
} from './modules/social-cards/index.js'
import {
  COMMENT_CATEGORIES,
  COMMENT_SENTIMENTS,
  CATEGORY_META,
  classifyByRules,
} from './lib/comment-classifier.js'
import {
  routeClassifiedMessage,
  registerCommentRouterRoutes,
} from './modules/comment-router/index.js'
import { setCommentRouterHook } from './conversations/orchestrator.js'
import {
  recordClosedTransaction,
  listClosedTransactions,
  getClosedTransaction,
  deleteClosedTransaction,
  importClosedTransactionsCsv,
  TRANSACTION_TYPES,
  BUYER_TYPES,
  PAYMENT_METHODS,
  ATTRIBUTION_SOURCES,
  CLOSE_REASONS,
} from './closed-transactions.js'
import {
  resolveContact360Feed,
  computeLeadScore,
  getLeadSummary,
  regenerateLeadSummary,
  CATEGORY_WEIGHTS,
} from './contact-360.js'
import { resolveListingPerformance } from './performance-dashboard.js'
import {
  isXEnabled,
  parseIncomingXWebhook,
  publishXTweet,
} from './lib/notifications/x.js'
import {
  getOrCreateContact,
  getOrCreateConversation,
  ingestInboundMessage,
  updateMessageStatus,
  sendOutboundMessage,
  assignConversation,
  closeConversation,
  reopenConversation,
  markConversationReadByAgent,
  mergeContacts,
} from './conversations/orchestrator.js'
import {
  createTask,
  getTaskById,
  getTasks,
  getOverdueTasks,
  getDueSoonTasks,
  getTasksDueToday,
  updateTask,
  completeTask,
  deleteTask,
  syncInquiryNextFollowUp,
  createViewingFollowUpTask,
} from './tasks.js'
import {
  createOpportunity,
  getOpportunityById,
  getOpportunities,
  getStageHistory,
  updateOpportunity,
  getPipelineSummary,
  createOrAdvanceOpportunityFromViewing,
} from './opportunities.js'
import { buildContactTimeline } from './contacts/timeline.js'
import { getCrmAnalytics, getCommunicationsAnalytics } from './analytics/crm.js'
import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  enrollContact,
  getEnrollments,
  getEnrollmentById,
  updateEnrollment,
  cancelEnrollment,
  getCampaignMessages,
  runCampaignScheduler,
  autoEnrollContactsForCampaign,
} from './campaigns.js'
import {
  createReminderPolicy,
  getReminderPolicies,
  getReminderPolicyById,
  updateReminderPolicy,
  deleteReminderPolicy,
  resolveReminderPolicy,
  evaluateReminderPolicy,
  markReminderSent,
} from './reminders.js'
import {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
  getDefaultTemplates,
  getTemplatesForAgent,
} from './message-templates.js'
import {
  getPublicApiBase,
  getPublicAppBase,
  generateWidgetEmbed,
  importListingsForAgency,
  parseListingsPayload,
  parseSimpleXmlProperties,
  resolveLeadAgent,
  getAgencyInventory,
  buildWidgetBootstrapScript,
} from './whiteLabel.js'
import {
  ensureUniqueAgentSlug,
  getActiveAffiliation,
  assertCanJoinAgency,
  endAffiliation,
  reassignAgencyTiedListing,
  resolveListingAffiliation,
  isMarketplaceVisible,
  recordProfileView,
  getEngagementSummary,
  followEntity,
  unfollowEntity,
  isFollowing,
  parseDeviceFromUa,
  inferGeoFromRequest,
  ensureListingEventSamples,
  aggregateListingEvents,
} from './platformModel.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const NODE_ENV = process.env.NODE_ENV || 'development'
const isProduction = NODE_ENV === 'production'
const RETRY_WORKER_ENABLED = process.env.DISTRIBUTION_RETRY_WORKER_ENABLED !== 'false'
const RETRY_WORKER_INTERVAL_MS = Math.max(5000, Number(process.env.DISTRIBUTION_RETRY_WORKER_INTERVAL_MS || 60000))
const RETRY_WORKER_BATCH_SIZE = Math.max(1, Math.min(200, Number(process.env.DISTRIBUTION_RETRY_WORKER_BATCH_SIZE || 20)))
const RETRY_MAX_ATTEMPTS = Math.max(1, Math.min(20, Number(process.env.DISTRIBUTION_RETRY_MAX_ATTEMPTS || 6)))
const RETRY_BASE_DELAY_MS = Math.max(10000, Number(process.env.DISTRIBUTION_RETRY_BASE_DELAY_MS || 300000))
const CONSUMER_AUTOMATION_ENABLED = process.env.CONSUMER_AUTOMATION_WORKER_ENABLED !== 'false'
const CONSUMER_AUTOMATION_INTERVAL_MS = Math.max(30000, Number(process.env.CONSUMER_AUTOMATION_WORKER_INTERVAL_MS || 120000))
const NOTIFICATION_RETRY_WORKER_ENABLED = process.env.NOTIFICATION_RETRY_WORKER_ENABLED !== 'false'
const NOTIFICATION_RETRY_WORKER_INTERVAL_MS = Math.max(10000, Number(process.env.NOTIFICATION_RETRY_WORKER_INTERVAL_MS || 60000))
const NOTIFICATION_RETRY_WORKER_BATCH_SIZE = Math.max(1, Math.min(100, Number(process.env.NOTIFICATION_RETRY_WORKER_BATCH_SIZE || 20)))
const VIEWING_REMINDER_LEAD_MINUTES = Math.max(5, Number(process.env.VIEWING_REMINDER_LEAD_MINUTES || 120))
const VIEWING_NO_SHOW_GRACE_MINUTES = Math.max(5, Number(process.env.VIEWING_NO_SHOW_GRACE_MINUTES || 90))
const CAMPAIGN_SCHEDULER_ENABLED = process.env.CAMPAIGN_SCHEDULER_ENABLED !== 'false'
const CAMPAIGN_SCHEDULER_INTERVAL_MS = Math.max(60000, Number(process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS || 300000))
const CAMPAIGN_SCHEDULER_BATCH_SIZE = Math.max(1, Math.min(200, Number(process.env.CAMPAIGN_SCHEDULER_BATCH_SIZE || 50)))
const AUDIT_LOG_RETENTION_DAYS = Math.max(1, Math.min(3650, Number(process.env.AUDIT_LOG_RETENTION_DAYS || 365)))
const ACTIVITY_LOG_RETENTION_DAYS = Math.max(1, Math.min(3650, Number(process.env.ACTIVITY_LOG_RETENTION_DAYS || 365)))
const RATE_LIMIT_GENERAL_MAX = Math.max(1, Number(process.env.RATE_LIMIT_GENERAL_MAX || (isProduction ? 200 : 500)))
const RATE_LIMIT_AUTH_MAX = Math.max(1, Number(process.env.RATE_LIMIT_AUTH_MAX || (isProduction ? 20 : 100)))

const app = express()
let retryWorkerTimer = null
let consumerAutomationWorkerTimer = null
let notificationRetryWorkerTimer = null
let campaignSchedulerTimer = null
const campaignSchedulerState = {
  running: false,
  last_run_at: null,
  last_processed: 0,
  last_error: null,
}
const notificationRetryWorkerState = {
  running: false,
  last_run_at: null,
  last_processed: 0,
  last_error: null,
}
const retryWorkerState = {
  running: false,
  last_run_at: null,
  last_processed: 0,
  last_error: null,
}
const consumerAutomationState = {
  running: false,
  last_run_at: null,
  last_result: null,
  last_error: null,
  run_history: [],
  metrics: {
    total_runs: 0,
    total_users_processed: 0,
    total_searches_processed: 0,
    total_matches: 0,
    total_inquiry_overdue_marked: 0,
    total_reminders_sent: 0,
    total_no_shows_marked: 0,
    total_failures: 0,
  },
}

// Wrap async route handlers so rejected promises reach the Express error middleware
const httpMethods = ['get', 'post', 'put', 'patch', 'delete']
httpMethods.forEach((method) => {
  const original = app[method].bind(app)
  app[method] = (path, ...handlers) => {
    const wrapped = handlers.map((handler) => {
      if (typeof handler === 'function' && handler.constructor?.name === 'AsyncFunction') {
        return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
      }
      return handler
    })
    return original(path, ...wrapped)
  }
})

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}))

// CORS
function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || ''
  if (!raw) {
    return isProduction ? [] : ['http://localhost:7100']
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean)
}

const allowedOrigins = getAllowedOrigins()
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    if (!isProduction) return callback(null, true)
    logger.warn({ origin }, 'CORS blocked origin')
    const err = new Error('Not allowed by CORS')
    err.status = 403
    callback(err)
  },
  credentials: true,
}))

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded')
    res.status(429).json({ error: 'Too many requests, please try again later.' })
  },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Auth rate limit exceeded')
    res.status(429).json({ error: 'Too many requests, please try again later.' })
  },
})

app.use(generalLimiter)
app.use('/api/auth', authLimiter)
app.use('/api/inquiries', authLimiter)
app.use('/api/agents/:id/reviews', authLimiter)

// HTTPS redirect (when behind a proxy and FORCE_HTTPS is set)
if (isProduction && process.env.FORCE_HTTPS === 'true') {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false)
  app.use((req, res, next) => {
    if (req.secure) return next()
    res.redirect(301, `https://${req.headers.host}${req.url}`)
  })
}

app.use(express.json({ limit: '12mb', verify: (req, _res, buf) => { req.rawBody = buf } }))

const uploadsDir = join(__dirname, '../uploads')
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })
app.use('/uploads', express.static(uploadsDir))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const safeExt = extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/gi, '') || '.bin'
      cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${safeExt}`)
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 15 },
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only image and video uploads are allowed'))
  },
})

await loadDb()
await seedData()

const areaIntelligenceModule = createAreaIntelligenceModule({
  platformAdapter: null, // uses DefaultPlatformAdapter
})
if (areaIntelligenceModule.enabled) {
  await areaIntelligenceModule.seed()
  await areaIntelligenceModule.registerRoutes(app)
  await areaIntelligenceModule.registerWorkers()
}

const marketPricingModule = createMarketPricingModule({
  platformAdapter: null, // uses DefaultPlatformAdapter
})
if (marketPricingModule.enabled) {
  await marketPricingModule.seed()
  await marketPricingModule.registerRoutes(app)
  await marketPricingModule.registerWorkers()
}

const PRICING_RELEVANT_PROPERTY_FIELDS = new Set([
  'price', 'currency', 'property_type', 'bedrooms', 'bathrooms', 'area', 'building_age_years',
  'condition', 'furnished', 'view_type', 'payment_method', 'city', 'neighborhood', 'location',
  'latitude', 'longitude', 'status',
])

async function invalidatePricingForPropertyChange(property) {
  if (!marketPricingModule.enabled || !property) return
  try {
    await marketPricingModule.services.recalculationJobService.invalidateForPropertyChange(property)
  } catch (err) {
    logger.error({ err: err.message, propertyId: property.id }, 'Failed to invalidate pricing after property change')
  }
}

const whatsAppListingsModule = createWhatsAppListingsModule({
  platformAdapter: createWhatsAppPlatformAdapter({
    pricingContextBuilder: marketPricingModule.enabled
      ? (property) => marketPricingModule.services.whatsAppContext.buildContext(property)
      : null,
  }),
})
if (whatsAppListingsModule.enabled) {
  await whatsAppListingsModule.registerRoutes(app)
  await whatsAppListingsModule.registerWorker()
}

const listingsAiModule = createListingsAiModule()
if (listingsAiModule.enabled) {
  listingsAiModule.registerRoutes(app, { authMiddleware })
}

const socialCardsModule = createSocialCardsModule()
if (socialCardsModule.enabled) {
  await socialCardsModule.prepare()
  socialCardsModule.registerRoutes(app, { authMiddleware })
}

/* ============================================================================
 * Comment router — inject the dispatch hook into the orchestrator + register
 * the tenant routing-config endpoints.
 * ========================================================================== */

registerCommentRouterRoutes(app, { authMiddleware })

setCommentRouterHook(async (message) => {
  await routeClassifiedMessage({
    message,
    orchestrator: { sendOutboundMessage },
    aiAdapter: listingsAiModule.enabled ? listingsAiModule.aiAdapter : null,
    aiProvider: listingsAiModule.config?.aiProvider,
    logger,
  })
})

/* ============================================================================
 * Comment classifier — AI reclassification worker
 *
 * Periodically picks up public-comment messages whose rules-stage
 * classification landed on `general` or was low-confidence, batches them
 * to the multi-provider AI adapter, and updates rows with the improved
 * classification. Never touches `category_source === 'manual'` rows.
 *
 * Opt-in via COMMENT_CLASSIFIER_AI_ENABLED (default: on when the
 * listings-ai module is enabled).
 * ========================================================================== */

const COMMENT_CLASSIFIER_AI_ENABLED = process.env.COMMENT_CLASSIFIER_AI_ENABLED !== 'false' && listingsAiModule.enabled
const COMMENT_CLASSIFIER_INTERVAL_MS = Math.max(30_000, Number(process.env.COMMENT_CLASSIFIER_INTERVAL_MS || 300_000))
const COMMENT_CLASSIFIER_BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.COMMENT_CLASSIFIER_BATCH_SIZE || 10)))
let commentClassifierTimer = null

async function runCommentClassifierBatch() {
  if (!listingsAiModule.enabled) return { skipped: 'ai_module_disabled' }
  const publicChannels = new Set(['instagram_comment', 'facebook_comment', 'tiktok_comment', 'x_mention', 'linkedin_comment'])
  const rows = await findAll('conversation_messages', (m) => {
    if (m.direction !== 'inbound') return false
    if (m.category_source === 'manual') return false
    if (m.category_source === 'ai') return false // already handled
    if (!publicChannels.has(m.channel)) return false
    if (!m.content) return false
    // Rules stage left us at general OR sub-threshold confidence.
    return m.category === 'general' || (typeof m.category_confidence === 'number' && m.category_confidence < 0.6)
  })

  if (!rows.length) return { batched: 0, updated: 0 }

  const batch = rows.slice(0, COMMENT_CLASSIFIER_BATCH_SIZE)
  const items = batch.map((m) => ({ id: m.id, text: m.content }))
  const { classifyBatchByAi } = await import('./lib/comment-classifier.js')
  let classifications = []
  try {
    classifications = await classifyBatchByAi({
      items,
      aiAdapter: listingsAiModule.aiAdapter,
      provider: listingsAiModule.config?.aiProvider,
    })
  } catch (err) {
    logger.warn({ err: err.message }, 'Comment classifier AI batch failed')
    return { batched: items.length, updated: 0, error: err.message }
  }

  let updated = 0
  for (const c of classifications) {
    if (!c?.id) continue
    await update('conversation_messages', (m) => m.id === c.id, (m) => ({
      ...m,
      category: c.category,
      sentiment: c.sentiment,
      category_confidence: c.confidence,
      category_source: 'ai',
      category_matched_rule: c.reasoning || null,
      category_updated_at: new Date().toISOString(),
    }))
    // Re-route with the upgraded category — the router's idempotency guard
    // keys on (message_id, category, category_source) so this fires exactly
    // once per (rules→ai) upgrade.
    const upgraded = await findOne('conversation_messages', (m) => m.id === c.id)
    if (upgraded) {
      void routeClassifiedMessage({
        message: upgraded,
        orchestrator: { sendOutboundMessage },
        aiAdapter: listingsAiModule.enabled ? listingsAiModule.aiAdapter : null,
        aiProvider: listingsAiModule.config?.aiProvider,
        logger,
      }).catch((err) => logger.warn({ err: err.message, messageId: c.id }, 'Router re-dispatch failed'))
    }
    updated++
  }
  return { batched: items.length, updated }
}

app.post('/api/admin/comment-classifier/run', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Admin only' })
  const result = await runCommentClassifierBatch()
  res.json(result)
})

app.post('/api/uploads', authMiddleware, (req, res) => {
  upload.array('files', 15)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' })
    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' })
    const items = files.map((f) => ({
      url: `/uploads/${f.filename}`,
      media_type: f.mimetype.startsWith('video/') ? 'video' : 'image',
      filename: f.originalname,
      size: f.size,
      content_type: f.mimetype,
    }))
    res.json({ items })
  })
})

function serializeProperty(p) {
  const photos = Array.isArray(p.photos) ? p.photos : (p.photos?.split('|') || [])
  const amenities = Array.isArray(p.amenities) ? p.amenities : (p.amenities?.split(',').filter(Boolean) || [])
  let media = p.media
  if (typeof media === 'string') {
    try { media = JSON.parse(media) } catch { media = [] }
  }
  if (!Array.isArray(media)) media = []
  if (!media.length && photos.length) {
    media = photos.map((url, i) => ({
      id: `legacy-${i}`,
      url,
      media_type: /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('youtube') || url.includes('vimeo') ? 'video' : 'image',
      classification: 'Other',
      source: 'link',
    }))
  }
  const photoUrls = media.length
    ? media.map((m) => m.url).filter(Boolean)
    : photos
  return {
    ...p,
    photos: photoUrls,
    amenities,
    media,
    latitude: p.latitude != null && p.latitude !== '' ? Number(p.latitude) : null,
    longitude: p.longitude != null && p.longitude !== '' ? Number(p.longitude) : null,
    developed_by: p.developed_by || '',
    interior_design_by: p.interior_design_by || '',
  }
}

function serializeAgent(a) {
  const {
    password_hash,
    token_version,
    password_changed_at,
    compromised_session_reset_at,
    ...rest
  } = a
  const languages = Array.isArray(a.languages) ? a.languages : (a.languages?.split(',').map(s => s.trim()).filter(Boolean) || [])
  return { ...rest, languages }
}

function requireRole(roles) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
      const member = await getAgencyMembership(req.params.agencyId, req.user.id)
      if (!member || !roles.includes(member.role)) return res.status(403).json({ error: 'Forbidden' })
      req.tenantMembership = member
      next()
    } catch (err) {
      next(err)
    }
  }
}

async function requireAnyAgencyRole(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const member = await getActiveAffiliation(req.user.id)
    if (!member) return res.status(403).json({ error: 'Not an agency member' })
    req.agencyId = member.agency_id
    req.memberRole = member.role
    next()
  } catch (err) {
    next(err)
  }
}

async function requireAdmin(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    if (req.user.platform_role !== 'platform_admin') {
      return res.status(403).json({ error: 'Forbidden: platform admin required' })
    }
    next()
  } catch (err) {
    next(err)
  }
}

async function requirePlatformAdmin(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    if (!(await isPlatformAdmin(req.user.id))) return res.status(403).json({ error: 'Forbidden: platform admin required' })
    next()
  } catch (err) {
    next(err)
  }
}

async function requireOwnerOrAdmin(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    const isAdmin = req.user.platform_role === 'platform_admin'
    if (req.user.id !== req.params.id && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden: owner or admin required' })
    }
    next()
  } catch (err) {
    next(err)
  }
}

async function isPlatformAdmin(userId) {
  const user = await findUserById(userId)
  return user?.platform_role === 'platform_admin'
}

async function checkPostgresHealth() {
  try {
    await getPool().query('SELECT 1 AS ok')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

function generateSecureToken(bytes = 32) {
  return randomBytes(bytes).toString('hex')
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

async function issueRecoveryToken({ userId, email, type, caseId = null, ttlMinutes = 30, ip = null, userAgent = null }) {
  const token = generateSecureToken(32)
  const tokenHash = hashToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

  // Revoke older issued tokens of the same type for this user.
  await update('auth_recovery_tokens', (r) => r.user_id === userId && r.type === type && r.status === 'issued', (r) => ({
    ...r,
    status: 'revoked',
    revoked_at: now.toISOString(),
    revoked_reason: 'superseded',
  }))

  const record = {
    id: uuidv4(),
    user_id: userId,
    email,
    type,
    case_id: caseId,
    token_hash: tokenHash,
    status: 'issued',
    attempts: 0,
    max_attempts: 10,
    issued_ip: ip,
    issued_user_agent: userAgent,
    expires_at: expiresAt,
    created_at: now.toISOString(),
  }
  await insert('auth_recovery_tokens', record)
  return { token, record }
}

async function consumeRecoveryToken({ token, type, caseId = null }) {
  const tokenHash = hashToken(token)
  const record = await findOne('auth_recovery_tokens', (r) =>
    r.type === type &&
    r.token_hash === tokenHash &&
    r.status === 'issued' &&
    (!caseId || r.case_id === caseId),
  )

  if (!record) {
    return { ok: false, status: 401, error: 'Invalid or expired recovery token' }
  }

  const now = new Date()
  if (new Date(record.expires_at) <= now) {
    await update('auth_recovery_tokens', (r) => r.id === record.id, (r) => ({
      ...r,
      status: 'expired',
      expired_at: now.toISOString(),
    }))
    return { ok: false, status: 410, error: 'Recovery token has expired' }
  }

  if ((record.attempts || 0) >= (record.max_attempts || 10)) {
    await update('auth_recovery_tokens', (r) => r.id === record.id, (r) => ({
      ...r,
      status: 'blocked',
      blocked_at: now.toISOString(),
    }))
    return { ok: false, status: 429, error: 'Recovery token is blocked after too many attempts' }
  }

  await update('auth_recovery_tokens', (r) => r.id === record.id, (r) => ({
    ...r,
    attempts: (r.attempts || 0) + 1,
    last_attempt_at: now.toISOString(),
  }))

  return { ok: true, record: await findOne('auth_recovery_tokens', (r) => r.id === record.id) }
}

async function markRecoveryTokenUsed(recordId, meta = {}) {
  await update('auth_recovery_tokens', (r) => r.id === recordId, (r) => ({
    ...r,
    status: 'used',
    used_at: new Date().toISOString(),
    used_meta: meta,
  }))
}

async function revokeOutstandingRecoveryTokens(userId, reason = 'password_changed') {
  await update('auth_recovery_tokens', (r) => r.user_id === userId && r.status === 'issued', (r) => ({
    ...r,
    status: 'revoked',
    revoked_at: new Date().toISOString(),
    revoked_reason: reason,
  }))
}

// ==================== AUTH ====================
app.post('/api/auth/register', validate(registerSchema), async (req, res) => {
  const body = req.validated
  if (await findUserByEmail(body.email) || await findOne('agents', a => a.email === body.email)) {
    return res.status(409).json({ error: 'Email already registered' })
  }
  const contactVerified = Boolean(body.otp_verified)
  const profileCompleted = Boolean(body.specialization || body.bio || body.office_address)
  const hasAgencyPath = body.agency_mode === 'existing' || body.agency_mode === 'new'
  const onboardingSteps = {
    contact_verified: contactVerified,
    profile_completed: profileCompleted,
    agency_affiliation_started: hasAgencyPath,
    terms_accepted: Boolean(body.terms_accepted),
    activation_reviewed: false,
    account_active: false,
  }
  const onboardingStage = contactVerified
    ? (hasAgencyPath ? 'agency_affiliation' : 'activation_review')
    : 'contact_verification'
  const onboardingStatus = contactVerified ? 'pending_activation' : 'pending_verification'

  const id = uuidv4()
  const slug = await ensureUniqueAgentSlug(body.name || body.email.split('@')[0] || id, id)
  const adminEmails = new Set([
    process.env.ADMIN_EMAIL,
    process.env.SMOKE_ADMIN_EMAIL,
  ].filter(Boolean))
  const isAdmin = adminEmails.has(body.email)

  const createdAt = new Date().toISOString()
  const role = 'agent'
  const user = {
    id,
    name: body.name,
    email: body.email,
    phone: body.phone,
    password_hash: bcrypt.hashSync(body.password, 10),
    role,
    platform_role: isAdmin ? 'platform_admin' : null,
    token_version: 0,
    created_at: createdAt,
    updated_at: createdAt,
  }
  const agent = {
    id,
    user_id: id,
    name: body.name,
    email: body.email,
    phone: body.phone,
    license_number: body.license_number,
    agency_name: body.agency_name,
    agency_license: body.agency_license,
    specialization: body.specialization,
    languages: body.languages,
    bio: body.bio,
    verified: 0, rating: 0, review_count: 0,
    role, slug, photo: `https://i.pravatar.cc/150?u=${encodeURIComponent(body.email)}`,
    experience_since: new Date().getFullYear(),
    office_address: body.office_address || '',
    onboarding_stage: onboardingStage,
    onboarding_status: onboardingStatus,
    onboarding_steps: onboardingSteps,
    territories: Array.isArray(body.territories) ? body.territories : [],
    property_types: Array.isArray(body.property_types) ? body.property_types : [],
    activation_requested_at: new Date().toISOString(),
    created_at: createdAt,
    updated_at: createdAt,
  }
  try {
    await createAgentAccount({ user, agent })
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Email already registered' })
    throw err
  }
  res.json({
    token: signToken({ id, email: body.email, name: body.name, token_version: 0 }),
    agent: {
      ...serializeAgent(agent),
      role,
      platform_role: user.platform_role,
      affiliation: null,
      affiliations: [],
      personal_tenant_id: `personal:${id}`,
    },
  })
})

app.post('/api/auth/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.validated
  const user = await findUserByEmail(email)
  if (!user?.password_hash || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' })
  const agent = await findAgentForUser(user.id)
  if (!agent) return res.status(401).json({ error: 'Invalid credentials' })
  const affiliation = await getActiveAffiliation(user.id)
  const agency = affiliation ? await findOne('agencies', a => a.id === affiliation.agency_id) : null
  const affiliations = await listUserAgencyMemberships(user.id)
  const tokenVersion = Number(user.token_version ?? 0)
  res.json({
    token: signToken({ id: user.id, email: user.email, name: user.name, token_version: tokenVersion }),
    agent: {
      ...serializeAgent(agent),
      role: user.role,
      platform_role: user.platform_role || null,
      affiliation: affiliation ? { agency_id: affiliation.agency_id, role: affiliation.role, agency_name: agency?.name } : null,
      affiliations: affiliations.map((membership) => ({
        tenant_id: membership.tenant_id,
        agency_id: membership.agency_id,
        agency_name: membership.agency?.name || null,
        role: membership.role,
        affiliation_mode: membership.affiliation_mode,
        status: membership.status,
      })),
      personal_tenant_id: `personal:${user.id}`,
    },
  })
})

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const agent = await findAgentForUser(req.user.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  const affiliation = await getActiveAffiliation(req.user.id)
  const agency = affiliation ? await findOne('agencies', a => a.id === affiliation.agency_id) : null
  const affiliations = await listUserAgencyMemberships(req.user.id)
  res.json({
    ...serializeAgent(agent),
    role: req.user.role,
    platform_role: req.user.platform_role || null,
    affiliation: affiliation ? { agency_id: affiliation.agency_id, role: affiliation.role, agency_name: agency?.name } : null,
    affiliations: affiliations.map((membership) => ({
      tenant_id: membership.tenant_id,
      agency_id: membership.agency_id,
      agency_name: membership.agency?.name || null,
      role: membership.role,
      affiliation_mode: membership.affiliation_mode,
      status: membership.status,
    })),
    personal_tenant_id: `personal:${req.user.id}`,
  })
})

app.get('/api/auth/tenant-context', authMiddleware, async (req, res) => {
  const memberships = await findAll(
    'tenant_memberships',
    (membership) => membership.user_id === req.user.id && membership.status === 'active',
  )
  const tenants = await findAll('tenants')
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]))
  res.json({
    personal_tenant_id: `personal:${req.user.id}`,
    memberships: memberships.map((membership) => ({
      ...membership,
      tenant: tenantById.get(membership.tenant_id) || null,
    })),
  })
})

app.put('/api/auth/me', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.user.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  const allowed = ['name', 'phone', 'bio', 'specialization', 'languages', 'photo', 'response_time', 'agency_name', 'agency_license', 'slug', 'cta_config']
  const patch = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }
  if (patch.email !== undefined) patch.email = String(patch.email).trim().toLowerCase()
  if (patch.slug) patch.slug = await ensureUniqueAgentSlug(patch.slug, req.user.id)
  else if (patch.name && !agent.slug) patch.slug = await ensureUniqueAgentSlug(patch.name, req.user.id)
  await update('agents', a => a.id === req.user.id, a => ({ ...a, ...patch }))
  const principalPatch = {}
  if (patch.name !== undefined) principalPatch.name = patch.name
  if (patch.phone !== undefined) principalPatch.phone = patch.phone
  if (Object.keys(principalPatch).length) await updateUser(req.user.id, principalPatch)
  const updated = await findOne('agents', a => a.id === req.user.id)
  res.json(serializeAgent(updated))
})

app.get('/api/auth/onboarding', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.user.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  res.json({
    onboarding_stage: agent.onboarding_stage || 'contact_verification',
    onboarding_status: agent.onboarding_status || 'pending_verification',
    onboarding_steps: agent.onboarding_steps || {
      contact_verified: false,
      profile_completed: false,
      agency_affiliation_started: false,
      terms_accepted: false,
      activation_reviewed: false,
      account_active: false,
    },
  })
})

app.patch('/api/auth/onboarding', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.user.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const currentSteps = agent.onboarding_steps || {}
  const nextSteps = {
    ...currentSteps,
    ...(req.body?.onboarding_steps || {}),
  }

  const nextStage = req.body?.onboarding_stage || agent.onboarding_stage || 'contact_verification'
  const nextStatus = req.body?.onboarding_status || agent.onboarding_status || 'pending_verification'

  await update('agents', a => a.id === req.user.id, a => ({
    ...a,
    onboarding_stage: nextStage,
    onboarding_status: nextStatus,
    onboarding_steps: nextSteps,
    activation_reviewed_at: nextSteps.activation_reviewed ? new Date().toISOString() : (a.activation_reviewed_at || null),
    activated_at: nextSteps.account_active ? new Date().toISOString() : (a.activated_at || null),
  }))

  const updated = await findOne('agents', a => a.id === req.user.id)
  res.json({
    onboarding_stage: updated.onboarding_stage,
    onboarding_status: updated.onboarding_status,
    onboarding_steps: updated.onboarding_steps,
  })
})

app.post('/api/auth/password/forgot', validate(passwordForgotSchema), async (req, res) => {
  const email = req.validated.email
  const genericResponse = {
    success: true,
    message: 'If an account exists for that email, recovery instructions have been sent.',
  }

  const user = await findUserByEmail(email)
  if (!user) {
    return res.json(genericResponse)
  }

  const { token } = await issueRecoveryToken({
    userId: user.id,
    email: user.email,
    type: 'password_reset',
    ttlMinutes: 30,
    ip: req.ip,
    userAgent: req.get('user-agent') || null,
  })

  await logActivity({
    type: 'password_reset_requested',
    agent_id: user.id,
    meta: { email: user.email, ip: req.ip },
  })

  if (!isProduction) {
    return res.json({
      ...genericResponse,
      _dev_reset_token: token,
      _dev_reset_url: `${await getPublicAppBase()}/reset-password?token=${encodeURIComponent(token)}`,
    })
  }

  res.json(genericResponse)
})

app.post('/api/auth/password/reset', validate(passwordResetSchema), async (req, res) => {
  const { token, password } = req.validated
  const consumed = await consumeRecoveryToken({ token, type: 'password_reset' })
  if (!consumed.ok) return res.status(consumed.status).json({ error: consumed.error })

  const recovery = consumed.record
  const user = await findUserById(recovery.user_id)
  if (!user) return res.status(404).json({ error: 'Account not found' })

  const newHash = bcrypt.hashSync(password, 12)
  const nextTokenVersion = Number(user.token_version ?? 0) + 1
  await updateUser(user.id, {
    password_hash: newHash,
    token_version: nextTokenVersion,
    password_changed_at: new Date().toISOString(),
  })

  await markRecoveryTokenUsed(recovery.id, { ip: req.ip, flow: 'password_reset' })
  await revokeOutstandingRecoveryTokens(user.id, 'password_reset_completed')

  await logActivity({
    type: 'password_reset_completed',
    agent_id: user.id,
    meta: { ip: req.ip },
  })

  res.json({ success: true, message: 'Password updated successfully. Please sign in again.' })
})

app.post('/api/auth/password/change', authMiddleware, validate(passwordChangeSchema), async (req, res) => {
  const { current_password, new_password } = req.validated
  const user = await findUserById(req.user.id)
  if (!user) return res.status(404).json({ error: 'Account not found' })

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' })
  }

  if (bcrypt.compareSync(new_password, user.password_hash)) {
    return res.status(400).json({ error: 'New password must be different from current password' })
  }

  const newHash = bcrypt.hashSync(new_password, 12)
  const nextTokenVersion = Number(user.token_version ?? 0) + 1
  await updateUser(user.id, {
    password_hash: newHash,
    token_version: nextTokenVersion,
    password_changed_at: new Date().toISOString(),
  })
  await revokeOutstandingRecoveryTokens(user.id, 'password_changed')

  await logActivity({
    type: 'password_changed',
    agent_id: user.id,
    meta: { ip: req.ip },
  })

  const refreshedUser = await findUserById(user.id)
  const newToken = signToken({
    id: refreshedUser.id,
    email: refreshedUser.email,
    name: refreshedUser.name,
    token_version: Number(refreshedUser.token_version ?? 0),
  })

  res.json({ success: true, token: newToken, message: 'Password changed successfully.' })
})

app.post('/api/auth/recovery/request', validate(accountRecoveryRequestSchema), async (req, res) => {
  const { email, reason, preferred_channel, contact } = req.validated
  const genericResponse = {
    success: true,
    message: 'Your recovery request has been submitted for review. If eligible, instructions will be sent securely.',
  }

  const user = await findUserByEmail(email)
  if (!user) {
    return res.json(genericResponse)
  }

  const existingOpenCase = await findOne('account_recovery_cases', (c) =>
    c.user_id === user.id && ['pending_review', 'approved'].includes(c.status),
  )

  if (existingOpenCase) {
    return res.json(genericResponse)
  }

  const recoveryCase = {
    id: uuidv4(),
    user_id: user.id,
    email: user.email,
    preferred_channel,
    contact,
    reason,
    status: 'pending_review',
    requested_ip: req.ip,
    requested_user_agent: req.get('user-agent') || null,
    created_at: new Date().toISOString(),
  }
  await insert('account_recovery_cases', recoveryCase)

  await logActivity({
    type: 'account_recovery_requested',
    agent_id: user.id,
    meta: { case_id: recoveryCase.id, preferred_channel },
  })

  res.json(!isProduction
    ? { ...genericResponse, _dev_case_id: recoveryCase.id }
    : genericResponse)
})

app.post('/api/auth/recovery/complete', validate(accountRecoveryCompleteSchema), async (req, res) => {
  const { case_id, token, password } = req.validated
  const recoveryCase = await findOne('account_recovery_cases', (c) => c.id === case_id)
  if (!recoveryCase) return res.status(404).json({ error: 'Recovery case not found' })
  if (recoveryCase.status !== 'approved') return res.status(403).json({ error: 'Recovery case is not approved' })

  const consumed = await consumeRecoveryToken({ token, type: 'account_recovery', caseId: case_id })
  if (!consumed.ok) return res.status(consumed.status).json({ error: consumed.error })

  const user = await findUserById(recoveryCase.user_id)
  if (!user) return res.status(404).json({ error: 'Account not found' })

  const newHash = bcrypt.hashSync(password, 12)
  const nextTokenVersion = Number(user.token_version ?? 0) + 1
  await updateUser(user.id, {
    password_hash: newHash,
    token_version: nextTokenVersion,
    password_changed_at: new Date().toISOString(),
    compromised_session_reset_at: new Date().toISOString(),
  })

  await markRecoveryTokenUsed(consumed.record.id, { ip: req.ip, flow: 'account_recovery' })
  await revokeOutstandingRecoveryTokens(user.id, 'account_recovery_completed')
  await update('account_recovery_cases', (c) => c.id === case_id, (c) => ({
    ...c,
    status: 'completed',
    completed_at: new Date().toISOString(),
    completion_ip: req.ip,
  }))

  await logActivity({
    type: 'account_recovery_completed',
    agent_id: user.id,
    meta: { case_id },
  })

  res.json({ success: true, message: 'Account recovery completed. Please sign in with your new password.' })
})

// ==================== OTP VERIFICATION ====================
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function cleanContact(channel, contact) {
  if (channel === 'whatsapp') return contact.replace(/\s+/g, '').replace(/^0/, '+961')
  return contact.trim().toLowerCase()
}

app.post('/api/auth/send-otp', validate(otpSendSchema), async (req, res) => {
  const { channel, contact } = req.validated
  const cleaned = cleanContact(channel, contact)
  const code = generateOtp()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min

  // Remove any existing OTP for this contact
  await remove('otp_verifications', o => o.contact === cleaned && o.channel === channel)

  await insert('otp_verifications', {
    id: uuidv4(),
    channel,
    contact: cleaned,
    code,
    expires_at: expiresAt,
    verified: false,
    attempts: 0,
    created_at: new Date().toISOString(),
  })

  const delivery = await sendOtp({ channel, contact: cleaned, code })

  logger.info({ channel, contact: cleaned, code, delivered: delivery.delivered, simulated: delivery.simulated }, 'OTP generated')

  res.json({
    success: true,
    message: delivery.simulated
      ? `OTP for ${channel} is simulated; configure a provider to enable live delivery.`
      : `OTP sent to ${channel === 'whatsapp' ? 'WhatsApp' : channel}.`,
    contact: cleaned,
    delivery,
    // Only include code in dev environments
    ...(process.env.NODE_ENV !== 'production' ? { _dev_code: code } : {}),
  })
})

app.post('/api/auth/verify-otp', validate(otpVerifySchema), async (req, res) => {
  const { contact, code } = req.validated

  const cleaned = contact.trim().toLowerCase()
  const record = await findOne('otp_verifications', o => o.contact === cleaned)
  if (!record) return res.status(404).json({ error: 'No OTP found for this contact. Please request a new one.' })

  if (new Date(record.expires_at) < new Date()) {
    await remove('otp_verifications', o => o.id === record.id)
    return res.status(410).json({ error: 'OTP has expired. Please request a new one.' })
  }

  if (record.attempts >= 5) {
    await remove('otp_verifications', o => o.id === record.id)
    return res.status(429).json({ error: 'Too many failed attempts. Please request a new OTP.' })
  }

  await update('otp_verifications', o => o.id === record.id, o => ({ ...o, attempts: o.attempts + 1 }))

  if (record.code !== String(code).trim()) {
    return res.status(401).json({ error: 'Invalid OTP. Please try again.', remaining_attempts: 5 - record.attempts - 1 })
  }

  await update('otp_verifications', o => o.id === record.id, o => ({ ...o, verified: true }))
  res.json({ success: true, verified: true, contact: cleaned })
})

// ==================== PROPERTIES ====================
app.get('/api/properties', validateQuery(propertyQuerySchema), async (req, res) => {
  const q = req.validatedQuery
  let props = await findAll('properties')
  // Decision 4: marketplace only shows syndicated listings by default (agent-scoped lists include all)
  if (!q.agentId && q.include_unsyndicated !== '1' && q.include_unsyndicated !== 'true') {
    props = props.filter(isMarketplaceVisible)
  }
  if (q.city) {
    const cityNorm = q.city.toLowerCase()
    props = props.filter(p => p.city?.toLowerCase() === cityNorm || p.location?.toLowerCase().includes(cityNorm))
  }
  if (q.neighborhood) props = props.filter(p => p.neighborhood === q.neighborhood)
  if (q.type) props = props.filter(p => p.type === q.type)
  const pType = q.propertyType || q.property_type
  if (pType) props = props.filter(p => p.property_type === pType)
  if (q.minPrice != null) props = props.filter(p => p.price >= q.minPrice)
  if (q.maxPrice != null) props = props.filter(p => p.price <= q.maxPrice)
  if (q.bedrooms != null) props = props.filter(p => p.bedrooms >= q.bedrooms)
  if (q.agentId) props = props.filter(p => p.agent_id === q.agentId)
  if (q.featured) props = props.filter(p => p.featured === 1 || p.featured === true)
  if (q.search) {
    const s = q.search.toLowerCase()
    props = props.filter(p => p.title?.toLowerCase().includes(s) || p.location?.toLowerCase().includes(s) || p.neighborhood?.toLowerCase().includes(s))
  }
  res.json(props.map(serializeProperty))
})

app.get('/api/properties/:id', async (req, res) => {
  const p = await findOne('properties', p => p.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Property not found' })
  // Increment platform-level views (Decision 1 engagement)
  await update('properties', x => x.id === p.id, x => ({ ...x, views: (x.views || 0) + 1 }))
  const ua = req.headers['user-agent'] || ''
  const device = await parseDeviceFromUa(ua)
  const geo = await inferGeoFromRequest(req, p.id)
  const channel = req.query.channel || 'marketplace'
  await recordProfileView({
    entityType: 'property',
    entityId: p.id,
    channel,
    device,
    geo_city: geo.city,
    geo_country: geo.country,
    geo_region: geo.region,
    referrer: req.get('referer') || 'direct',
  })
  await insert('listing_events', {
    id: uuidv4(),
    property_id: p.id,
    type: 'view',
    channel,
    device,
    geo_city: geo.city,
    geo_country: geo.country,
    geo_region: geo.region,
    referrer: req.get('referer') || 'direct',
    created_at: new Date().toISOString(),
  })
  const updated = await findOne('properties', x => x.id === p.id)
  const canonicalId = updated.canonical_id || updated.id
  let offers = []
  if (!updated.ungroup_override) {
    offers = (await findAll('properties', async o => (o.canonical_id || o.id) === canonicalId && o.id !== updated.id && await isMarketplaceVisible(o)))
      .map(serializeProperty)
  }
  res.json({
    ...serializeProperty(updated),
    offers: offers.map(o => ({
      id: o.id,
      agent_id: o.agent_id,
      agent_name: o.agent_name,
      agency_id: o.agency_id,
      agency_name: o.agency_name,
      price: o.price,
      title: o.title,
      photos: o.photos,
      description: o.description,
      listing_owner_type: o.listing_owner_type,
    })),
  })
})

function buildDefaultCtaConfig() {
  return {
    contact: { enabled: true, channels: ['email', 'whatsapp'], mode: 'direct' },
    schedule_call: { enabled: true, channels: ['phone'] },
    book_viewing: { enabled: true, channels: ['email', 'whatsapp'] },
    more_from_agent: { enabled: true, label: 'More properties from this agent' },
    more_from_agency: { enabled: true, label: 'More properties from this agency' },
  }
}

function mergeCtaConfig(agentConfig, agencyConfig) {
  const base = buildDefaultCtaConfig()
  const merged = { ...base }
  for (const key of Object.keys(base)) {
    if (agencyConfig?.[key] !== undefined) merged[key] = { ...merged[key], ...agencyConfig[key] }
    if (agentConfig?.[key] !== undefined) merged[key] = { ...merged[key], ...agentConfig[key] }
  }
  return merged
}

app.get('/api/properties/:id/cta-config', async (req, res) => {
  const p = await findOne('properties', p => p.id === req.params.id)
  if (!p) return res.status(404).json({ error: 'Property not found' })
  const agent = p.agent_id ? await findOne('agents', a => a.id === p.agent_id) : null
  const agencyId = p.agency_id || (agent ? (await findOne('agency_members', m => m.user_id === agent.id && m.status === 'active'))?.agency_id : null)
  const agency = agencyId ? await findOne('agencies', a => a.id === agencyId) : null
  const config = mergeCtaConfig(agent?.cta_config, agency?.cta_config)
  res.json({
    property_id: p.id,
    agent_id: agent?.id || null,
    agency_id: agency?.id || null,
    agent_name: agent?.name || null,
    agency_name: agency?.name || null,
    cta_config: config,
  })
})

app.post('/api/properties', authMiddleware, validate(propertyCreateSchema), async (req, res) => {
  const body = req.validated
  const id = uuidv4()
  const agent = await findOne('agents', a => a.id === req.user.id)
  const affiliation = await resolveListingAffiliation({
    agentId: req.user.id,
    agencyTiedRequested: body.agency_tied,
  })
  const canonicalId = body.canonical_id || id
  const territoryId = body.territory_id || 'territory-lb'
  // Decision 2: validate required territory disclosure fields
  const requiredFields = await findAll('territory_disclosure_fields', f => f.territory_id === territoryId && f.required)
  for (const field of requiredFields) {
    const val = body[field.key] ?? body.disclosures?.[field.key]
    if (val === undefined || val === null || val === '') {
      return res.status(400).json({ error: `Missing required disclosure: ${field.label}`, field: field.key, territory_id: territoryId })
    }
  }
  const prop = {
    id,
    ...body,
    canonical_id: canonicalId,
    agent_id: req.user.id,
    agent_name: agent.name,
    agent_photo: agent.photo,
    agent_license: agent.license_number,
    agency_name: affiliation.agency_name || agent.agency_name || '',
    agency_id: affiliation.agency_id,
    agency_tied: affiliation.agency_tied,
    listing_owner_type: affiliation.listing_owner_type,
    marketplace_syndicated: body.marketplace_syndicated === undefined ? true : !!body.marketplace_syndicated,
    ungroup_override: !!body.ungroup_override,
    territory_id: territoryId,
    classification: body.classification ?? body.property_type ?? '',
    permissible_buildup_area: body.permissible_buildup_area ?? body.area ?? null,
    status: body.status || 'active',
    listed_date: new Date().toISOString().split('T')[0],
    views: 0,
  }
  delete prop.disclosures
  if (Array.isArray(prop.media)) {
    prop.photos = prop.media.map((m) => m.url).filter(Boolean)
  }
  if (Array.isArray(prop.photos)) prop.photos = prop.photos.join('|')
  if (Array.isArray(prop.amenities)) prop.amenities = prop.amenities.join(',')
  if (prop.latitude !== undefined && prop.latitude !== null && prop.latitude !== '') prop.latitude = Number(prop.latitude)
  if (prop.longitude !== undefined && prop.longitude !== null && prop.longitude !== '') prop.longitude = Number(prop.longitude)
  prop.developed_by = prop.developed_by || ''
  prop.interior_design_by = prop.interior_design_by || ''

  const propertyRecord = await createPropertyWithCanonical({
    transaction: (work) => transaction(work),
    createProperty: async () => {
      await insert('properties', prop)
      return prop
    },
    createCanonical: async (propertyId) => {
      const existingCanonical = await findOne('canonical_properties', c => c.id === canonicalId)
      if (existingCanonical) return existingCanonical
      await insert('canonical_properties', {
        id: canonicalId,
        primary_listing_id: propertyId,
        location: body.location,
        city: body.city,
        neighborhood: body.neighborhood,
        address: body.address,
        latitude: body.latitude,
        longitude: body.longitude,
        property_type: body.property_type,
        ungroup_override: !!body.ungroup_override,
        created_at: new Date().toISOString(),
      })
    },
  })

  await invalidatePricingForPropertyChange(propertyRecord)

  res.json(serializeProperty(propertyRecord))
})

app.put('/api/properties/:id', authMiddleware, validate(propertyUpdateSchema), async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  let updates = { ...req.validated }
  if (updates.agency_tied !== undefined) {
    const affiliation = await resolveListingAffiliation({ agentId: req.user.id, agencyTiedRequested: updates.agency_tied })
    updates = { ...updates, ...affiliation }
  }
  if (Array.isArray(updates.media)) {
    updates.photos = updates.media.map((m) => m.url).filter(Boolean)
  }
  if (Array.isArray(updates.photos)) updates.photos = updates.photos.join('|')
  if (Array.isArray(updates.amenities)) updates.amenities = updates.amenities.join(',')
  if (updates.latitude !== undefined && updates.latitude !== null && updates.latitude !== '') updates.latitude = Number(updates.latitude)
  if (updates.longitude !== undefined && updates.longitude !== null && updates.longitude !== '') updates.longitude = Number(updates.longitude)
  if (updates.ungroup_override !== undefined && prop.canonical_id) {
    await update('canonical_properties', c => c.id === prop.canonical_id, c => ({ ...c, ungroup_override: !!updates.ungroup_override }))
  }
  await update('properties', p => p.id === req.params.id, p => ({ ...p, ...updates }))
  if (Object.keys(updates).some((field) => PRICING_RELEVANT_PROPERTY_FIELDS.has(field))) {
    await invalidatePricingForPropertyChange({ ...prop, ...updates })
  }
  res.json(serializeProperty({ ...prop, ...updates }))
})

/** Decision 3: attach another agency/agent offer to an existing canonical property */
app.post('/api/properties/:id/offers', authMiddleware, async (req, res) => {
  const base = await findOne('properties', p => p.id === req.params.id)
  if (!base) return res.status(404).json({ error: 'Base listing not found' })
  if (base.ungroup_override) return res.status(400).json({ error: 'This property is ungrouped and cannot accept variants' })
  const agent = await findOne('agents', a => a.id === req.user.id)
  const affiliation = await resolveListingAffiliation({ agentId: req.user.id, agencyTiedRequested: req.body.agency_tied })
  const id = uuidv4()
  const offer = {
    id,
    canonical_id: base.canonical_id || base.id,
    title: req.body.title || base.title,
    description: req.body.description || base.description,
    type: req.body.type || base.type,
    property_type: req.body.property_type || base.property_type,
    price: req.body.price ?? base.price,
    price_unit: req.body.price_unit || base.price_unit,
    bedrooms: req.body.bedrooms ?? base.bedrooms,
    bathrooms: req.body.bathrooms ?? base.bathrooms,
    area: req.body.area ?? base.area,
    area_unit: req.body.area_unit || base.area_unit,
    location: base.location,
    city: base.city,
    neighborhood: base.neighborhood,
    address: base.address,
    latitude: base.latitude,
    longitude: base.longitude,
    amenities: req.body.amenities || base.amenities,
    furnished: req.body.furnished ?? base.furnished,
    photos: req.body.photos || base.photos,
    agent_id: req.user.id,
    agent_name: agent.name,
    agent_photo: agent.photo,
    agent_license: agent.license_number,
    agency_name: affiliation.agency_name || agent.agency_name || '',
    agency_id: affiliation.agency_id,
    agency_tied: affiliation.agency_tied,
    listing_owner_type: affiliation.listing_owner_type,
    marketplace_syndicated: req.body.marketplace_syndicated === undefined ? true : !!req.body.marketplace_syndicated,
    ungroup_override: false,
    territory_id: base.territory_id || 'territory-lb',
    classification: req.body.classification || base.classification,
    permissible_buildup_area: req.body.permissible_buildup_area ?? base.permissible_buildup_area,
    status: 'active',
    listed_date: new Date().toISOString().split('T')[0],
    views: 0,
    reference: req.body.reference || '',
    permit_number: req.body.permit_number || '',
  }
  if (Array.isArray(offer.photos)) offer.photos = offer.photos.join('|')
  if (Array.isArray(offer.amenities)) offer.amenities = offer.amenities.join(',')
  await insert('properties', offer)
  await invalidatePricingForPropertyChange(offer)
  res.json(serializeProperty(offer))
})

app.delete('/api/properties/:id', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  await remove('properties', p => p.id === req.params.id)
  await invalidatePricingForPropertyChange({ ...prop, status: 'deleted' })
  res.json({ success: true })
})

app.get('/api/properties/:id/price-history', async (req, res) => {
  const history = (await findAll('price_history', h => h.property_id === req.params.id)).sort((a, b) => new Date(a.date) - new Date(b.date))
  res.json(history)
})

app.get('/api/properties/:id/comps', async (req, res, next) => {
  try {
    if (marketPricingModule?.enabled) {
      const property = await findOne('properties', p => p.id === req.params.id)
      if (!property) return res.status(404).json({ error: 'Not found' })
      const comps = await marketPricingModule.services.comparableService.findComparables(property, {})
      return res.json(comps)
    }
    // Legacy fallback
    const prop = await findOne('properties', p => p.id === req.params.id)
    if (!prop) return res.status(404).json({ error: 'Not found' })
    const comps = (await findAll('properties', p => p.id !== prop.id && p.neighborhood === prop.neighborhood && p.property_type === prop.property_type)).slice(0, 5)
    res.json(comps.map(serializeProperty))
  } catch (err) {
    next(err)
  }
})

app.get('/api/properties/:id/zestimate', async (req, res, next) => {
  try {
    if (marketPricingModule?.enabled) {
      const analysis = await marketPricingModule.services.analysisService.getAnalysis(req.params.id)
      return res.json({
        zestimate: analysis.median_price,
        zestimate_low: analysis.percentile_25,
        zestimate_high: analysis.percentile_75,
        rangeLow: analysis.percentile_25,
        rangeHigh: analysis.percentile_75,
        list_price: analysis.target_price || null,
        difference: analysis.target_vs_median_percent || 0,
        difference_pct: analysis.target_vs_median_percent || 0,
        confidence: analysis.confidence,
        comps_used: analysis.comparable_count,
        price_per_sqm: null,
        trend_pct: 0,
        market_context_sentence: analysis.market_context_sentence,
        lastUpdated: analysis.calculated_at ? analysis.calculated_at.split('T')[0] : new Date().toISOString().split('T')[0],
      })
    }
    // Legacy fallback
    const prop = await findOne('properties', p => p.id === req.params.id)
    if (!prop) return res.status(404).json({ error: 'Not found' })
    const history = await findAll('price_history', h => h.property_id === req.params.id)
    const current = prop.price
    const trend = history.length >= 2 ? (history[history.length - 1].price - history[0].price) / history[0].price : 0
    const zestimate = Math.round(current * (1 + trend * 0.3))
    const rangeLow = Math.round(zestimate * 0.92)
    const rangeHigh = Math.round(zestimate * 1.08)
    res.json({ zestimate, rangeLow, rangeHigh, confidence: trend > 0 ? 'High' : 'Medium', lastUpdated: new Date().toISOString().split('T')[0] })
  } catch (err) {
    next(err)
  }
})

// ==================== AGENTS ====================
app.get('/api/agents', async (req, res) => {
  const { search } = req.query
  let agents = (await findAll('agents')).map(serializeAgent)
  if (search) {
    const s = String(search).toLowerCase()
    agents = agents.filter(a =>
      a.name?.toLowerCase().includes(s) ||
      a.specialization?.toLowerCase().includes(s) ||
      a.agency_name?.toLowerCase().includes(s) ||
      a.slug?.toLowerCase().includes(s),
    )
  }
  res.json(await Promise.all(agents.map(async (a) => {
    const aff = await getActiveAffiliation(a.id)
    const agency = aff ? await findOne('agencies', x => x.id === aff.agency_id) : null
    return {
      ...a,
      affiliation: aff ? { agency_id: aff.agency_id, role: aff.role, agency_name: agency?.name } : null,
    }
  })))
})

app.get('/api/territories', async (_req, res) => {
  res.json(await findAll('territories'))
})

app.get('/api/territories/:id/disclosure-fields', async (req, res) => {
  const territory = await findOne('territories', t => t.id === req.params.id || t.code === req.params.id)
  if (!territory) return res.status(404).json({ error: 'Territory not found' })
  const fields = (await findAll('territory_disclosure_fields', f => f.territory_id === territory.id))
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  res.json({ territory, fields })
})

app.get('/api/agents/:id/transactions', async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  res.json(await findAll('transactions', t => t.agent_id === agent.id))
})

app.get('/api/agents/:id/reviews', async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  res.json(await findAll('reviews', r => r.agent_id === agent.id))
})

app.post('/api/agents/:id/reviews', async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  const review = { id: uuidv4(), agent_id: agent.id, ...req.body, verified_transaction: 0 }
  await insert('reviews', review)
  const agentReviews = await findAll('reviews', r => r.agent_id === agent.id)
  const avg = agentReviews.reduce((s, r) => s + r.rating, 0) / agentReviews.length
  await update('agents', a => a.id === agent.id, a => ({ ...a, rating: Math.round(avg * 10) / 10, review_count: agentReviews.length }))
  res.json(review)
})

/** Decision 1: detailed channel breakdown is agent-only until PA confirms agency visibility */
app.get('/api/agents/:id/engagement', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  const isAdmin = req.user.platform_role === 'platform_admin'
  if (req.user.id !== agent.id && !isAdmin) {
    return res.status(403).json({ error: 'Engagement breakdown is visible to the agent only (pending PA decision)' })
  }
  res.json(await getEngagementSummary('agent', agent.id))
})

app.post('/api/agents/:id/follow', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  if (agent.id === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' })
  res.json(await followEntity({ followerId: req.user.id, entityType: 'agent', entityId: agent.id }))
})

app.delete('/api/agents/:id/follow', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  res.json(await unfollowEntity({ followerId: req.user.id, entityType: 'agent', entityId: agent.id }))
})

app.get('/api/agents/:id/following-me', authMiddleware, async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id) || await findOne('agents', a => a.slug === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  res.json({ following: await isFollowing({ followerId: req.user.id, entityType: 'agent', entityId: agent.id }) })
})

app.get('/api/agents/:idOrSlug', async (req, res) => {
  let agent = await findOne('agents', a => a.id === req.params.idOrSlug)
  if (!agent) agent = await findOne('agents', a => a.slug === req.params.idOrSlug)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  await recordProfileView({ entityType: 'agent', entityId: agent.id, channel: req.query.channel || 'web_profile' })
  const listings = await findAll('properties', p => p.agent_id === agent.id)
  const transactions = await findAll('transactions', t => t.agent_id === agent.id)
  const aff = await getActiveAffiliation(agent.id)
  const agency = aff ? await findOne('agencies', a => a.id === aff.agency_id) : null
  const summary = await getEngagementSummary('agent', agent.id)
  res.json({
    ...serializeAgent(agent),
    listings: listings.map(serializeProperty),
    transactions,
    affiliation: aff ? { agency_id: aff.agency_id, role: aff.role, agency_name: agency?.name } : null,
    agency: agency || null,
    engagement: {
      views_total: summary.views_total,
      followers_total: summary.followers_total,
    },
  })
})

// ==================== NEIGHBORHOODS ====================
app.get('/api/neighborhoods', async (req, res) => {
  res.json(await findAll('neighborhood_stats'))
})

app.get('/api/neighborhoods/:name/stats', async (req, res) => {
  const stats = await findOne('neighborhood_stats', n => n.name.toLowerCase() === req.params.name.toLowerCase())
  if (!stats) return res.status(404).json({ error: 'Not found' })
  const comps = (await findAll('properties', p => p.neighborhood.toLowerCase() === req.params.name.toLowerCase())).slice(0, 5)
  res.json({ ...stats, comparableSales: comps.map(serializeProperty) })
})

// ==================== INQUIRIES ====================
app.post('/api/inquiries', validate(inquirySchema), async (req, res) => {
  const body = req.validated
  const prop = body.property_id ? await findOne('properties', p => p.id === body.property_id) : null
  let agencyId = body.agency_id || prop?.agency_id || null
  if (!agencyId && prop?.agent_id) {
    const membership = await findOne('agency_members', m => m.user_id === prop.agent_id && m.status === 'active')
    agencyId = membership?.agency_id || null
  }
  const agentId = await resolveLeadAgent({
    agencyId,
    propertyId: body.property_id,
    source: body.source || 'marketplace',
    preferredAgentId: prop?.agent_id || body.agent_id || null,
  })
  const contactMode = body.contact_mode === 'platform_routed' ? 'platform_routed' : 'direct'
  const { contact } = await getOrCreateContact({
    email: body.email,
    phone: body.phone,
    name: body.name,
    assignedAgentId: agentId,
    agencyId,
    source: body.source || 'marketplace',
    channel: body.channel || 'web',
  })

  const inquiry = {
    id: uuidv4(),
    property_id: body.property_id || null,
    property_title: body.property_title || prop?.title || 'General inquiry',
    agent_id: agentId,
    agency_id: agencyId,
    site_id: body.site_id || null,
    landing_page: body.landing_page || null,
    name: body.name,
    email: body.email.trim().toLowerCase(),
    phone: body.phone || '',
    message: body.message,
    source: body.source || 'marketplace',
    channel: body.channel || 'web',
    contact_mode: contactMode,
    status: 'new',
    priority: 'normal',
    stage: 'new',
    assigned_to: agentId || null,
    first_response_at: null,
    next_follow_up_at: null,
    response_sla_minutes: 30,
    response_due_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    closed_at: null,
    lost_reason: '',
    contact_id: contact?.id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await insert('inquiries', inquiry)

  // Platform-routed contact: send an auto-reply to the customer and create a
  // follow-up task for the assigned agent so the inquiry is handled centrally.
  if (contactMode === 'platform_routed' && contact?.id) {
    let autoReplyChannel = null
    if (contact.email) autoReplyChannel = 'email'
    else if (contact.phone) autoReplyChannel = 'whatsapp'

    if (autoReplyChannel) {
      try {
        const { conversation } = await getOrCreateConversation({
          contactId: contact.id,
          channel: autoReplyChannel,
          assignedAgentId: agentId,
          subject: `Inquiry for ${inquiry.property_title || 'property'}`,
        })
        await sendOutboundMessage({
          conversationId: conversation.id,
          content: 'Thank you for your interest. We have received your request and forwarded it to the relevant agent/agency. Would you like us to refer more similar properties?',
          contentType: 'text',
          sentByAgentId: null,
        }).catch((err) => logger.warn({ err: err.message }, 'platform-routed auto-reply failed'))
      } catch (err) {
        logger.warn({ err: err.message }, 'platform-routed auto-reply conversation creation failed')
      }
    }

    if (agentId) {
      await createTask({
        contactId: contact.id,
        inquiryId: inquiry.id,
        assignedTo: agentId,
        type: 'follow_up',
        title: 'Platform-routed inquiry: follow up with lead',
        notes: `Inquiry from ${body.name} via ${body.channel || 'web'} for "${inquiry.property_title || 'property'}". Contact mode: platform-routed.`,
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        priority: 'high',
        createdBy: 'system',
      })
    }
  }

  await insert('activity_log', {
    id: uuidv4(),
    type: 'inquiry_created',
    property_id: inquiry.property_id,
    agent_id: inquiry.agent_id,
    meta: { inquiry_id: inquiry.id, channel: inquiry.channel, source: inquiry.source, agency_id: agencyId },
    created_at: new Date().toISOString(),
  })
  res.json(inquiry)
})

app.get('/api/inquiries', authMiddleware, validateQuery(inquiryQuerySchema), async (req, res) => {
  const q = req.validatedQuery
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  let rows = await Promise.all((await findAll('inquiries', i => agentProps.includes(i.property_id) || i.agent_id === req.user.id))
    .map(async (i) => {
      const viewings = await findAll('viewings', (v) => v.inquiry_id === i.id)
      const nextViewing = viewings
        .filter((v) => ['scheduled', 'confirmed'].includes(v.status))
        .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] || null
      const now = Date.now()
      const overdue = i.status === 'new' && i.response_due_at && new Date(i.response_due_at).getTime() < now && !i.first_response_at
      return {
        ...i,
        sla_overdue: Boolean(overdue),
        viewings_count: viewings.length,
        next_viewing_at: nextViewing?.scheduled_at || null,
      }
    }))
  if (q.status) rows = rows.filter(i => i.status === q.status)
  if (q.stage) rows = rows.filter(i => i.stage === q.stage)
  if (q.priority) rows = rows.filter(i => i.priority === q.priority)
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  let startIndex = 0
  if (q.cursor) {
    const idx = rows.findIndex(i => i.id === q.cursor)
    startIndex = idx >= 0 ? idx + 1 : rows.length
  }
  const items = rows.slice(startIndex, startIndex + q.limit)
  const nextCursor = items.length === q.limit ? items[items.length - 1].id : null
  res.json({ items, next_cursor: nextCursor, has_more: !!nextCursor })
})

app.get('/api/inquiries/:id', authMiddleware, async (req, res) => {
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  const inquiry = await findOne('inquiries', i => i.id === req.params.id && (agentProps.includes(i.property_id) || i.agent_id === req.user.id))
  if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' })
  const viewings = await findAll('viewings', (v) => v.inquiry_id === inquiry.id)
  const nextViewing = viewings
    .filter((v) => ['scheduled', 'confirmed'].includes(v.status))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0] || null
  const now = Date.now()
  const overdue = inquiry.status === 'new' && inquiry.response_due_at && new Date(inquiry.response_due_at).getTime() < now && !inquiry.first_response_at
  res.json({
    ...inquiry,
    sla_overdue: Boolean(overdue),
    viewings_count: viewings.length,
    next_viewing_at: nextViewing?.scheduled_at || null,
  })
})

app.patch('/api/inquiries/:id', authMiddleware, validate(inquiryUpdateSchema), async (req, res) => {
  const inquiry = await findOne('inquiries', i => i.id === req.params.id)
  if (!inquiry) return res.status(404).json({ error: 'Not found' })
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  if (!agentProps.includes(inquiry.property_id) && inquiry.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const patch = req.validated
  const nowIso = new Date().toISOString()
  await update('inquiries', i => i.id === req.params.id, i => {
    const nextStatus = patch.status || i.status
    const transitionedFromNew = i.status === 'new' && nextStatus !== 'new'
    const firstResponseAt = patch.first_response_at ?? (transitionedFromNew ? nowIso : (i.first_response_at || null))
    const closedStatuses = ['closed_won', 'closed_lost']
    return {
      ...i,
      status: nextStatus,
      priority: patch.priority || i.priority || 'normal',
      stage: patch.stage || i.stage || 'new',
      assigned_to: patch.assigned_to === undefined ? (i.assigned_to || i.agent_id || req.user.id) : patch.assigned_to,
      first_response_at: firstResponseAt,
      next_follow_up_at: patch.next_follow_up_at === undefined ? (i.next_follow_up_at || null) : patch.next_follow_up_at,
      lost_reason: patch.lost_reason === undefined ? (i.lost_reason || '') : patch.lost_reason,
      closed_at: closedStatuses.includes(nextStatus) ? (i.closed_at || nowIso) : i.closed_at,
      updated_at: nowIso,
    }
  })
  const updated = await findOne('inquiries', i => i.id === req.params.id)
  await logActivity({
    type: 'inquiry_updated',
    property_id: updated?.property_id,
    agent_id: req.user.id,
    meta: { inquiry_id: req.params.id, status: updated?.status, stage: updated?.stage, priority: updated?.priority },
  })
  res.json(updated)
})

app.get('/api/inquiries/:id/timeline', authMiddleware, async (req, res) => {
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  const inquiry = await findOne('inquiries', i => i.id === req.params.id && (agentProps.includes(i.property_id) || i.agent_id === req.user.id))
  if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' })

  const viewings = (await findAll('viewings', v => v.inquiry_id === inquiry.id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const activities = (await findAll('activity_log', a => a.meta?.inquiry_id === inquiry.id || a.property_id === inquiry.property_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const activitiesWithNames = await Promise.all(activities.map(async (a) => {
    const actor = a.agent_id ? await findOne('agents', x => x.id === a.agent_id) : null
    return { ...a, actor_name: actor?.name || 'System' }
  }))

  const now = new Date()
  const followUps = []
  if (inquiry.next_follow_up_at) {
    followUps.push({
      id: inquiry.id,
      type: 'scheduled_follow_up',
      due_at: inquiry.next_follow_up_at,
      label: 'Scheduled follow-up',
      status: new Date(inquiry.next_follow_up_at).getTime() <= now.getTime() ? 'overdue' : 'upcoming',
    })
  }
  viewings.forEach((v) => {
    if (v.follow_up_generated_at) {
      followUps.push({
        id: v.id,
        type: 'viewing_follow_up',
        due_at: v.follow_up_generated_at,
        label: `Follow-up after ${v.outcome || v.status} viewing`,
        status: new Date(v.follow_up_generated_at).getTime() <= now.getTime() ? 'overdue' : 'upcoming',
      })
    }
  })
  followUps.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())

  res.json({ inquiry, viewings, activities: activitiesWithNames, follow_ups: followUps })
})

app.get('/api/viewings', authMiddleware, async (req, res) => {
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  const rows = (await findAll('viewings', (v) => v.agent_id === req.user.id || agentProps.includes(v.property_id)))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  res.json(rows)
})

app.get('/api/viewings/:id', authMiddleware, async (req, res) => {
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  const viewing = await findOne('viewings', (v) => v.id === req.params.id && (v.agent_id === req.user.id || agentProps.includes(v.property_id)))
  if (!viewing) return res.status(404).json({ error: 'Viewing not found' })
  res.json(viewing)
})

app.post('/api/viewings', authMiddleware, validate(viewingCreateSchema), async (req, res) => {
  const body = req.validated
  const inquiry = await findOne('inquiries', (i) => i.id === body.inquiry_id)
  if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' })

  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  if (!agentProps.includes(inquiry.property_id) && inquiry.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const viewing = {
    id: uuidv4(),
    inquiry_id: inquiry.id,
    property_id: body.property_id || inquiry.property_id || null,
    property_title: inquiry.property_title || '',
    agent_id: inquiry.agent_id || req.user.id,
    client_name: inquiry.name,
    client_phone: inquiry.phone || '',
    client_email: inquiry.email || '',
    contact_id: inquiry.contact_id || null,
    scheduled_at: body.scheduled_at,
    duration_minutes: body.duration_minutes,
    mode: body.mode,
    location: body.location || '',
    notes: body.notes || '',
    status: 'scheduled',
    created_by: req.user.id,
    created_at: new Date().toISOString(),
  }
  await insert('viewings', viewing)
  await createViewingFollowUpTask({ viewing, inquiry, agentId: req.user.id })

  await update('inquiries', (i) => i.id === inquiry.id, (i) => ({
    ...i,
    status: i.status === 'new' ? 'contacted' : i.status,
    stage: 'viewing',
    next_follow_up_at: body.scheduled_at,
    updated_at: new Date().toISOString(),
  }))

  await logActivity({
    type: 'viewing_scheduled',
    property_id: viewing.property_id,
    agent_id: req.user.id,
    meta: { inquiry_id: inquiry.id, viewing_id: viewing.id, scheduled_at: viewing.scheduled_at, mode: viewing.mode },
  })
  res.json(viewing)
})

async function dispatchClientViewingNotification({ viewing, clientNotified, channel, notifyClient, agentId }) {
  if (!notifyClient || !clientNotified) return { ok: false, error: 'Notification not requested' }
  const inquiry = viewing.inquiry_id ? await findOne('inquiries', (i) => i.id === viewing.inquiry_id) : null
  const phone = viewing.client_phone || inquiry?.phone || ''
  const email = viewing.client_email || inquiry?.email || ''

  if (channel === 'whatsapp') {
    if (!isWhatsAppConfigured()) {
      return { ok: false, provider: 'whatsapp', error: 'WhatsApp is not configured' }
    }
    if (!phone) {
      return { ok: false, provider: 'whatsapp', error: 'Contact phone is missing' }
    }
    const { contact } = await getOrCreateContact({
      phone,
      email,
      name: viewing.client_name || inquiry?.name || '',
      assignedAgentId: agentId || viewing.agent_id || inquiry?.agent_id,
      source: 'viewing_notification',
      channel: 'whatsapp',
    })
    const { conversation } = await getOrCreateConversation({
      contactId: contact.id,
      channel: 'whatsapp',
      assignedAgentId: agentId || viewing.agent_id,
    })
    const { dispatch } = await sendOutboundMessage({
      conversationId: conversation.id,
      content: clientNotified.message,
      sentByAgentId: agentId,
    })
    return dispatch
  }

  if (channel === 'sms') {
    return { ok: false, provider: 'sms', error: 'SMS dispatcher not yet configured' }
  }
  if (channel === 'email') {
    return { ok: false, provider: 'email', error: 'Email dispatcher not yet configured' }
  }
  return { ok: false, error: `Unsupported notify channel: ${channel}` }
}

app.patch('/api/viewings/:id', authMiddleware, validate(viewingUpdateSchema), async (req, res) => {
  const viewing = await findOne('viewings', (v) => v.id === req.params.id)
  if (!viewing) return res.status(404).json({ error: 'Viewing not found' })
  const agentProps = (await findAll('properties', p => p.agent_id === req.user.id)).map(p => p.id)
  if (viewing.agent_id !== req.user.id && !agentProps.includes(viewing.property_id)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const patch = req.validated
  const now = new Date()
  const nowIso = now.toISOString()
  const previousStatus = viewing.status
  const previousScheduledAt = viewing.scheduled_at
  const notifyChannel = patch.notify_channel || 'email'
  const closedStatuses = ['closed_won', 'closed_lost']

  const isReschedule = patch.scheduled_at &&
    patch.scheduled_at !== previousScheduledAt &&
    ['scheduled', 'confirmed'].includes(previousStatus) &&
    ['scheduled', 'confirmed'].includes(patch.status || previousStatus)

  let clientNotified = viewing.client_notified || null
  if (isReschedule && patch.notify_client) {
    clientNotified = {
      channel: notifyChannel,
      message: `Your viewing for ${viewing.property_title || 'the property'} has been rescheduled to ${new Date(patch.scheduled_at).toLocaleString()}.`,
      sent_at: nowIso,
    }
  }
  if (patch.status === 'cancelled' && patch.notify_client) {
    clientNotified = {
      channel: notifyChannel,
      message: `Your viewing for ${viewing.property_title || 'the property'} scheduled for ${new Date(patch.scheduled_at || viewing.scheduled_at).toLocaleString()} has been cancelled. ${patch.outcome_notes || ''}`.trim(),
      sent_at: nowIso,
    }
  }

  if (clientNotified) {
    const dispatch = await dispatchClientViewingNotification({
      viewing,
      clientNotified,
      channel: notifyChannel,
      notifyClient: patch.notify_client,
      agentId: req.user.id,
    })
    clientNotified = {
      ...clientNotified,
      dispatched: dispatch.ok,
      provider: dispatch.provider,
      provider_message_id: dispatch.provider_message_id || null,
      dispatch_error: dispatch.error || null,
    }
  }

  await update('viewings', (v) => v.id === viewing.id, (v) => ({
    ...v,
    ...patch,
    client_notified: clientNotified,
    updated_at: nowIso,
  }))
  let updated = await findOne('viewings', (v) => v.id === viewing.id)

  if (updated?.inquiry_id) {
    const inquiry = await findOne('inquiries', (i) => i.id === updated.inquiry_id)
    if (inquiry) {
      const inquiryClosed = closedStatuses.includes(inquiry.status || '')
      let nextStage = inquiry.stage
      let nextStatusInq = inquiry.status
      let nextFollowUpAt = inquiry.next_follow_up_at

      if (['completed', 'cancelled', 'no_show'].includes(updated.status)) {
        if (updated.status === 'completed') {
          if (!updated.outcome) {
            await update('viewings', (v) => v.id === updated.id, (v) => ({ ...v, outcome: 'interested' }))
            updated = await findOne('viewings', (v) => v.id === updated.id)
          }
          const outcome = updated.outcome
          nextStage = outcome === 'interested' ? 'offer' : 'qualification'
          nextStatusInq = inquiry.status === 'new' ? 'contacted' : inquiry.status
          if (!inquiryClosed) {
            nextFollowUpAt = new Date(now.getTime() + (outcome === 'interested' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)).toISOString()
          }
        } else if (updated.status === 'cancelled') {
          if (!updated.outcome) {
            await update('viewings', (v) => v.id === updated.id, (v) => ({ ...v, outcome: 'cancelled' }))
            updated = await findOne('viewings', (v) => v.id === updated.id)
          }
          if (!inquiryClosed) {
            nextFollowUpAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString()
          }
        } else if (updated.status === 'no_show') {
          if (!updated.outcome) {
            await update('viewings', (v) => v.id === updated.id, (v) => ({ ...v, outcome: 'no_show' }))
            updated = await findOne('viewings', (v) => v.id === updated.id)
          }
          if (!inquiryClosed) {
            nextFollowUpAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()
          }
        }
      } else if (isReschedule) {
        nextFollowUpAt = patch.scheduled_at || inquiry.next_follow_up_at
      }

      await update('inquiries', (i) => i.id === updated.inquiry_id, (i) => ({
        ...i,
        stage: nextStage || i.stage,
        status: nextStatusInq || i.status,
        next_follow_up_at: nextFollowUpAt,
        updated_at: nowIso,
      }))

      if (nextFollowUpAt) {
        await update('viewings', (v) => v.id === updated.id, (v) => ({
          ...v,
          follow_up_generated_at: nextFollowUpAt,
        }))
        updated = await findOne('viewings', (v) => v.id === updated.id)
      }

      // Generate first-class task + opportunity updates after viewing transitions.
      if (!inquiryClosed) {
        await createViewingFollowUpTask({ viewing: updated, inquiry, agentId: req.user.id })
      }
      if (updated.status === 'completed') {
        await createOrAdvanceOpportunityFromViewing({ viewing: updated, inquiry, agentId: req.user.id })
      }
    }
  }

  if (updated.status === 'cancelled') {
    await logActivity({
      type: 'viewing_cancelled',
      property_id: updated?.property_id,
      agent_id: req.user.id,
      meta: { viewing_id: updated?.id, inquiry_id: updated?.inquiry_id, client_notified: !!clientNotified, reason: patch.outcome_notes },
    })
  } else if (updated.status === 'completed') {
    await logActivity({
      type: 'viewing_completed',
      property_id: updated?.property_id,
      agent_id: req.user.id,
      meta: { viewing_id: updated?.id, inquiry_id: updated?.inquiry_id, outcome: updated?.outcome },
    })
  } else if (updated.status === 'no_show') {
    await logActivity({
      type: 'viewing_no_show',
      property_id: updated?.property_id,
      agent_id: req.user.id,
      meta: { viewing_id: updated?.id, inquiry_id: updated?.inquiry_id },
    })
  } else if (isReschedule) {
    await logActivity({
      type: 'viewing_rescheduled',
      property_id: updated?.property_id,
      agent_id: req.user.id,
      meta: { viewing_id: updated?.id, inquiry_id: updated?.inquiry_id, scheduled_at: updated?.scheduled_at },
    })
  }

  await logActivity({
    type: 'viewing_updated',
    property_id: updated?.property_id,
    agent_id: req.user.id,
    meta: { viewing_id: updated?.id, status: updated?.status, inquiry_id: updated?.inquiry_id },
  })
  res.json(updated)
})

// ==================== DASHBOARD ====================
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  const myProps = await findAll('properties', p => p.agent_id === req.user.id)
  const myInquiries = await findAll('inquiries', i => myProps.some(p => p.id === i.property_id) || i.agent_id === req.user.id)
  const totalViews = myProps.reduce((s, p) => s + (p.views || 0), 0)
  const active = myProps.filter(p => !['sold', 'rented', 'withdrawn', 'expired', 'draft', 'hold', 'unpublished'].includes(p.status || 'active'))
  res.json({
    listings: active.length,
    totalListings: myProps.length,
    inquiries: myInquiries.length,
    totalInquiries: myInquiries.length,
    totalViews,
    avgViews: active.length ? Math.round(totalViews / Math.max(myProps.length, 1)) : 0,
    avgPrice: myProps.length ? Math.round(myProps.reduce((s, p) => s + p.price, 0) / myProps.length) : 0,
  })
})

app.get('/api/dashboard/analytics', authMiddleware, async (req, res) => {
  const myProps = await findAll('properties', p => p.agent_id === req.user.id)
  myProps.forEach(ensureListingEventSamples)

  const myInquiries = await findAll('inquiries', i => myProps.some(p => p.id === i.property_id) || i.agent_id === req.user.id)
  const allEvents = await findAll('listing_events', e => myProps.some(p => p.id === e.property_id))
  const byProperty = (await Promise.all(myProps.map(async (p) => {
    const events = allEvents.filter((e) => e.property_id === p.id)
    const agg = await aggregateListingEvents(events)
    const inqCount = myInquiries.filter((i) => i.property_id === p.id).length
    const distClicks = (await findAll('distributions', (d) => d.property_id === p.id)).reduce((s, d) => s + (d.clicks || 0), 0)
    return {
      id: p.id,
      title: p.title,
      city: p.city || (p.location || '').split(',')[0]?.trim() || '—',
      photo: Array.isArray(p.photos) ? p.photos[0] : (p.photos?.split('|')[0] || null),
      status: p.status || 'active',
      views: p.views || agg.views,
      clicks: Math.max(agg.clicks, distClicks),
      inquiries: inqCount,
      engagement: (p.views || 0) + inqCount + Math.max(agg.clicks, distClicks),
    }
  }))).sort((a, b) => b.views - a.views)

  const overall = await aggregateListingEvents(allEvents)
  const inquiriesByStatus = {}
  myInquiries.forEach((i) => {
    const st = i.status || 'new'
    inquiriesByStatus[st] = (inquiriesByStatus[st] || 0) + 1
  })

  res.json({
    overview: {
      listings: myProps.length,
      active_listings: myProps.filter(p => (p.status || 'active') === 'active').length,
      total_views: myProps.reduce((s, p) => s + (p.views || 0), 0),
      total_clicks: overall.clicks,
      total_inquiries: myInquiries.length,
      avg_views: myProps.length ? Math.round(myProps.reduce((s, p) => s + (p.views || 0), 0) / myProps.length) : 0,
    },
    by_property: byProperty,
    by_device: overall.by_device,
    by_geography: overall.by_geography,
    by_channel: overall.by_channel,
    by_referrer: overall.by_referrer,
    inquiries_by_status: Object.entries(inquiriesByStatus).map(([label, value]) => ({ label, value })),
    analytics_source: 'first_party',
    ga_note: 'First-party marketplace analytics. Google Analytics 4 (free) can be connected later via a Measurement ID for cross-site traffic.',
  })
})

app.get('/api/dashboard/operations', authMiddleware, async (req, res) => {
  const myProps = await findAll('properties', p => p.agent_id === req.user.id)
  const myInquiries = await findAll('inquiries', i => myProps.some(p => p.id === i.property_id) || i.agent_id === req.user.id)
  const myViewings = await findAll('viewings', (v) => v.agent_id === req.user.id || myProps.some(p => p.id === v.property_id))
  const nowIso = new Date().toISOString()
  const now = new Date(nowIso)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  const todaysViewings = myViewings
    .filter((v) => ['scheduled', 'confirmed'].includes(v.status) && v.scheduled_at >= todayStart && v.scheduled_at < todayEnd)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  const slaBreached = myInquiries.filter((i) =>
    i.status === 'new' && i.response_due_at && new Date(i.response_due_at).getTime() <= now.getTime() && !i.first_response_at,
  ).length

  // Task-first follow-up counts (next_follow_up_at is now a cache of the earliest pending task)
  const overdueTasks = await getOverdueTasks(req.user.id, nowIso)
  const dueSoonTasks = await getDueSoonTasks(req.user.id, nowIso)
  const dueTodayTasks = await getTasksDueToday(req.user.id, nowIso)
  const pipeline = await getPipelineSummary(req.user.id)

  // Backward-compatible counts kept for existing dashboard cards
  const overdueFollowUps = overdueTasks.length
  const followUpsDue = dueSoonTasks.length

  const pendingViewings = myViewings.filter((v) => ['scheduled', 'confirmed'].includes(v.status)).length
  res.json({
    sla_breached_count: slaBreached,
    todays_viewings: todaysViewings.map((v) => ({
      id: v.id,
      client_name: v.client_name || 'Client',
      scheduled_at: v.scheduled_at,
      mode: v.mode || 'in_person',
      property_title: v.property_title || null,
    })),
    overdue_follow_ups: overdueFollowUps,
    follow_ups_due: followUpsDue,
    pending_viewings: pendingViewings,
    tasks: {
      overdue: overdueTasks.slice(0, 50),
      due_soon: dueSoonTasks.slice(0, 50),
      due_today: dueTodayTasks.slice(0, 50),
      overdue_count: overdueTasks.length,
      due_soon_count: dueSoonTasks.length,
      due_today_count: dueTodayTasks.length,
    },
    pipeline: {
      total_value: pipeline.total_value,
      weighted_value: pipeline.weighted_value,
      open_opportunities: pipeline.total_opportunities,
      by_stage: pipeline.by_stage,
    },
    generated_at: nowIso,
  })
})

app.get('/api/analytics/crm', authMiddleware, async (req, res) => {
  const scopeAll = req.query.scope === 'all' && await isPlatformAdmin(req.user.id)
  const agentId = scopeAll ? null : req.user.id
  const agencyId = req.query.agency_id || null
  res.json(await getCrmAnalytics({ agentId, agencyId, startDate: req.query.start_date, endDate: req.query.end_date }))
})

// ==================== CAMPAIGNS / DRIP SEQUENCES ====================
app.get('/api/campaigns', authMiddleware, async (req, res) => {
  res.json(await getCampaigns({ status: req.query.status, trigger: req.query.trigger, createdBy: req.user.id }))
})

app.post('/api/campaigns', authMiddleware, async (req, res) => {
  try {
    const campaign = await createCampaign({
      name: req.body.name,
      description: req.body.description,
      status: req.body.status || 'draft',
      trigger: req.body.trigger || 'manual',
      tagsFilter: req.body.tags_filter || [],
      targetChannel: req.body.target_channel || 'email',
      steps: req.body.steps || [],
      createdBy: req.user.id,
    })
    await logActivity({ type: 'campaign_created', agent_id: req.user.id, meta: { campaign_id: campaign.id } })
    res.status(201).json(campaign)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/campaigns/:id', authMiddleware, async (req, res) => {
  const campaign = await getCampaignById(req.params.id)
  if (!campaign || campaign.created_by !== req.user.id) return res.status(404).json({ error: 'Campaign not found' })
  res.json(campaign)
})

app.patch('/api/campaigns/:id', authMiddleware, async (req, res) => {
  const campaign = await getCampaignById(req.params.id)
  if (!campaign || campaign.created_by !== req.user.id) return res.status(404).json({ error: 'Campaign not found' })
  try {
    const updated = await updateCampaign(req.params.id, req.body)
    await logActivity({ type: 'campaign_updated', agent_id: req.user.id, meta: { campaign_id: req.params.id } })
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.delete('/api/campaigns/:id', authMiddleware, async (req, res) => {
  const campaign = await getCampaignById(req.params.id)
  if (!campaign || campaign.created_by !== req.user.id) return res.status(404).json({ error: 'Campaign not found' })
  try {
    await deleteCampaign(req.params.id)
    await logActivity({ type: 'campaign_deleted', agent_id: req.user.id, meta: { campaign_id: req.params.id } })
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/campaigns/:id/enroll', authMiddleware, async (req, res) => {
  const campaign = await getCampaignById(req.params.id)
  if (!campaign || campaign.created_by !== req.user.id) return res.status(404).json({ error: 'Campaign not found' })
  try {
    const enrollment = await enrollContact({
      campaignId: req.params.id,
      contactId: req.body.contact_id,
      assignedAgentId: req.user.id,
    })
    await logActivity({ type: 'campaign_enrollment_created', agent_id: req.user.id, meta: { campaign_id: req.params.id, enrollment_id: enrollment.id, contact_id: enrollment.contact_id } })
    res.status(201).json(enrollment)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/campaigns/:id/auto-enroll', authMiddleware, async (req, res) => {
  const campaign = await getCampaignById(req.params.id)
  if (!campaign || campaign.created_by !== req.user.id) return res.status(404).json({ error: 'Campaign not found' })
  try {
    const enrolled = await autoEnrollContactsForCampaign(req.params.id, { maxContacts: req.body.max_contacts || 100 })
    await logActivity({ type: 'campaign_auto_enroll', agent_id: req.user.id, meta: { campaign_id: req.params.id, enrolled_count: enrolled.length } })
    res.json({ enrolled_count: enrolled.length, enrollments: enrolled })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/campaigns/:id/enrollments', authMiddleware, async (req, res) => {
  const campaign = await getCampaignById(req.params.id)
  if (!campaign || campaign.created_by !== req.user.id) return res.status(404).json({ error: 'Campaign not found' })
  res.json(await getEnrollments({ campaignId: req.params.id }))
})

app.get('/api/enrollments', authMiddleware, async (req, res) => {
  res.json(await getEnrollments({ assignedAgentId: req.user.id, status: req.query.status }))
})

app.get('/api/enrollments/:id', authMiddleware, async (req, res) => {
  const enrollment = await getEnrollmentById(req.params.id)
  if (!enrollment || enrollment.assigned_agent_id !== req.user.id) return res.status(404).json({ error: 'Enrollment not found' })
  res.json({ ...enrollment, messages: await getCampaignMessages({ enrollmentId: enrollment.id }) })
})

app.patch('/api/enrollments/:id', authMiddleware, async (req, res) => {
  const enrollment = await getEnrollmentById(req.params.id)
  if (!enrollment || enrollment.assigned_agent_id !== req.user.id) return res.status(404).json({ error: 'Enrollment not found' })
  try {
    const updated = await updateEnrollment(req.params.id, req.body)
    await logActivity({ type: 'campaign_enrollment_updated', agent_id: req.user.id, meta: { enrollment_id: req.params.id } })
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/campaigns/run-scheduler', authMiddleware, async (req, res) => {
  try {
    const summary = await runCampaignScheduler({ maxEnrollments: req.body.limit || CAMPAIGN_SCHEDULER_BATCH_SIZE })
    await logActivity({ type: 'campaign_scheduler_manual_run', agent_id: req.user.id, meta: { processed: summary.processed } })
    res.json(summary)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/analytics/crm', authMiddleware, async (req, res) => {
  const scopeAll = req.query.scope === 'all' && await isPlatformAdmin(req.user.id)
  const agentId = scopeAll ? null : req.user.id
  const agencyId = req.query.agency_id || null
  res.json(await getCrmAnalytics({ agentId, agencyId, startDate: req.query.start_date, endDate: req.query.end_date }))
})

app.get('/api/analytics/communications', authMiddleware, async (req, res) => {
  const scopeAll = req.query.scope === 'all' && await isPlatformAdmin(req.user.id)
  const agentId = scopeAll ? null : req.user.id
  const agencyId = req.query.agency_id || null
  res.json(await getCommunicationsAnalytics({ agentId, agencyId, startDate: req.query.start_date, endDate: req.query.end_date }))
})

app.get('/api/properties/:id/analytics', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id && !await isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  await ensureListingEventSamples(prop)
  const events = await findAll('listing_events', e => e.property_id === prop.id)
  const agg = await aggregateListingEvents(events)
  const inquiries = await findAll('inquiries', i => i.property_id === prop.id)
  const notes = (await findAll('listing_notes', n => n.property_id === prop.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const dists = await findAll('distributions', d => d.property_id === prop.id)
  res.json({
    property: serializeProperty(prop),
    ...agg,
    views: prop.views || agg.views,
    clicks: Math.max(agg.clicks, dists.reduce((s, d) => s + (d.clicks || 0), 0)),
    inquiries,
    notes,
    distributions: dists,
  })
})

app.post('/api/properties/:id/events', async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  const ua = req.headers['user-agent'] || ''
  const device = await parseDeviceFromUa(ua)
  const geo = await inferGeoFromRequest(req, prop.id)
  const type = req.body.type === 'click' ? 'click' : 'view'
  const event = {
    id: uuidv4(),
    property_id: prop.id,
    type,
    channel: req.body.channel || 'marketplace',
    device,
    geo_city: geo.city,
    geo_country: geo.country,
    geo_region: geo.region,
    referrer: req.body.referrer || req.get('referer') || 'direct',
    created_at: new Date().toISOString(),
  }
  await insert('listing_events', event)
  if (type === 'click') {
    await update('properties', p => p.id === prop.id, p => ({ ...p, clicks: (p.clicks || 0) + 1 }))
  }
  res.json(event)
})

app.get('/api/properties/:id/notes', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id && !await isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const notes = (await findAll('listing_notes', n => n.property_id === prop.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  res.json(notes)
})

app.post('/api/properties/:id/notes', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  const body = String(req.body.body || req.body.note || '').trim()
  if (!body) return res.status(400).json({ error: 'Note body is required' })
  const visibility = req.body.visibility === 'team' ? 'team' : 'private'
  const note = {
    id: uuidv4(),
    property_id: prop.id,
    agent_id: req.user.id,
    author_name: req.user.name || 'Agent',
    body,
    visibility,
    created_at: new Date().toISOString(),
  }
  await insert('listing_notes', note)
  res.json(note)
})

app.delete('/api/properties/:id/notes/:noteId', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  await remove('listing_notes', n => n.id === req.params.noteId && n.property_id === prop.id)
  res.json({ success: true })
})

app.get('/api/properties/:id/report', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  if (prop.agent_id !== req.user.id && !await isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  await ensureListingEventSamples(prop)
  const events = await findAll('listing_events', e => e.property_id === prop.id)
  const agg = await aggregateListingEvents(events)
  const inquiries = await findAll('inquiries', i => i.property_id === prop.id)
  const dists = await findAll('distributions', d => d.property_id === prop.id)
  res.json({
    generated_at: new Date().toISOString(),
    report_type: 'marketing_performance',
    property: serializeProperty(prop),
    performance: {
      views: prop.views || agg.views,
      clicks: Math.max(agg.clicks, dists.reduce((s, d) => s + (d.clicks || 0), 0)),
      inquiries: inquiries.length,
      distributions: dists.length,
      ...agg,
    },
    inquiries: inquiries.map((i) => ({
      name: i.name,
      email: i.email,
      phone: i.phone,
      status: i.status,
      source: i.source,
      channel: i.channel,
      created_at: i.created_at,
      message: i.message,
    })),
    channels: dists.map((d) => ({
      platform: d.platform,
      status: d.status,
      views: d.views || 0,
      clicks: d.clicks || 0,
      leads: d.leads || 0,
    })),
  })
})

function getDefaultNotificationPrefs(userId) {
  return buildDefaultNotificationPrefs(userId, { id: uuidv4() })
}

async function getOrCreateNotificationPrefs(userId) {
  const existing = await findOne('consumer_notification_prefs', (p) => p.user_id === userId)
  if (existing) return normalizeNotificationPrefs(existing)
  const prefs = getDefaultNotificationPrefs(userId)
  try {
    await insert('consumer_notification_prefs', prefs)
    return prefs
  } catch (err) {
    if (err?.code !== '23505') throw err
    const concurrent = await findOne('consumer_notification_prefs', (p) => p.user_id === userId)
    if (!concurrent) throw err
    return normalizeNotificationPrefs(concurrent)
  }
}

function isWithinQuietHours(prefs) {
  const qh = prefs?.quiet_hours
  if (!qh || !qh.enabled) return false
  const start = qh.start || '22:00'
  const end = qh.end || '08:00'
  const now = new Date()
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const parseMins = (s) => {
    const parts = String(s).split(':')
    const h = Number(parts[0] || 0)
    const m = Number(parts[1] || 0)
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  }
  const startMins = parseMins(start)
  const endMins = parseMins(end)
  if (startMins <= endMins) return mins >= startMins && mins <= endMins
  return mins >= startMins || mins <= endMins
}

function buildNotificationDedupeKey({ userId, type, meta = {} }) {
  let entityId = null
  if (type === 'saved_search_match') entityId = meta.saved_search_id
  else if (type === 'inquiry_sla_overdue') entityId = meta.inquiry_id
  else if (['viewing_reminder', 'viewing_no_show'].includes(type)) entityId = meta.viewing_id
  if (!entityId) entityId = meta.id || meta.entity_id || 'none'
  const day = new Date().toISOString().split('T')[0]
  return `${userId}:${type}:${entityId}:${day}`
}

function getNotificationChannel(type, meta = {}) {
  if (meta.channel) return meta.channel
  if (type === 'saved_search_match' && meta.alert_channel) return meta.alert_channel
  return 'inapp'
}

async function createNotification({ userId, type, title, body, severity = 'info', meta = {} }) {
  const prefs = await getOrCreateNotificationPrefs(userId)
  const eventEnabled = prefs.event_toggles?.[type] !== false
  if (!eventEnabled) return null

  const channel = getNotificationChannel(type, meta)
  const channelEnabled = prefs.channels?.[channel] !== false
  if (!channelEnabled) return null

  if (isWithinQuietHours(prefs)) return null

  const dedupeKey = buildNotificationDedupeKey({ userId, type, meta })
  const existing = await findOne('consumer_notifications', (n) =>
    n.user_id === userId &&
    n.type === type &&
    n.meta?.dedupe_key === dedupeKey,
  )
  if (existing) return existing

  const row = {
    id: uuidv4(),
    user_id: userId,
    type,
    title,
    body,
    severity,
    read: false,
    meta: { ...meta, dedupe_key: dedupeKey },
    dispatch: {
      channel,
      status: channel === 'inapp' ? 'delivered' : 'pending',
      attempts: 0,
      last_error: null,
      next_retry_at: null,
      sent_at: channel === 'inapp' ? new Date().toISOString() : null,
      delivered_at: channel === 'inapp' ? new Date().toISOString() : null,
      read_at: null,
    },
    created_at: new Date().toISOString(),
  }
  await insert('consumer_notifications', row)

  if (channel !== 'inapp') {
    await insert('consumer_notification_retries', {
      id: uuidv4(),
      notification_id: row.id,
      user_id: userId,
      channel,
      status: 'pending',
      attempts: 0,
      next_retry_at: new Date(Date.now() + 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    })
  }

  return row
}

async function dispatchNotification(notification) {
  // Dispatcher router for non-inapp channels.
  // Real providers (SendGrid, Twilio, WhatsApp Cloud API) are wired here.
  const channel = notification.dispatch?.channel
  if (!channel || channel === 'inapp') {
    return { ok: true, status: 'delivered' }
  }

  // Placeholder: channel-specific dispatchers would be invoked here.
  // For now, record that the dispatch is pending until a provider is configured.
  return {
    ok: false,
    status: 'pending',
    error: `Channel ${channel} dispatch not yet wired. Provider integration required.`,
  }
}

async function processPendingNotificationRetries({ limit = 20 } = {}) {
  const now = new Date().toISOString()
  const pending = (await findAll('consumer_notification_retries', (r) =>
    r.status === 'pending' &&
    (!r.next_retry_at || r.next_retry_at <= now),
  )).slice(0, limit)

  const results = []
  for (const retry of pending) {
    const notification = await findOne('consumer_notifications', (n) => n.id === retry.notification_id)
    if (!notification) {
      await update('consumer_notification_retries', (r) => r.id === retry.id, (r) => ({ ...r, status: 'failed', failed_at: now, last_error: 'Notification record missing' }))
      results.push({ retry_id: retry.id, status: 'failed', error: 'Notification record missing' })
      continue
    }

    const result = await dispatchNotification(notification)
    const attempts = (retry.attempts || 0) + 1
    const maxAttempts = 5
    const exhausted = attempts >= maxAttempts

    if (result.ok) {
      await update('consumer_notifications', (n) => n.id === notification.id, (n) => ({
        ...n,
        dispatch: { ...n.dispatch, status: result.status, attempts, sent_at: now, delivered_at: now },
      }))
      await update('consumer_notification_retries', (r) => r.id === retry.id, (r) => ({
        ...r,
        status: 'completed',
        attempts,
        completed_at: now,
      }))
      results.push({ retry_id: retry.id, status: 'completed' })
    } else {
      const nextRetryAt = exhausted
        ? null
        : new Date(Date.now() + Math.min(60 * Math.pow(2, attempts), 3600) * 1000).toISOString()
      await update('consumer_notifications', (n) => n.id === notification.id, (n) => ({
        ...n,
        dispatch: { ...n.dispatch, status: exhausted ? 'failed' : 'pending', attempts, last_error: result.error },
      }))
      await update('consumer_notification_retries', (r) => r.id === retry.id, (r) => ({
        ...r,
        status: exhausted ? 'failed' : 'pending',
        attempts,
        last_error: result.error,
        next_retry_at: nextRetryAt,
        failed_at: exhausted ? now : r.failed_at,
      }))
      results.push({ retry_id: retry.id, status: exhausted ? 'failed' : 'pending', error: result.error })
    }
  }

  return { processed: results.length, results }
}

async function getAutomationCheckpoint(agentId) {
  const existing = await findOne('consumer_automation_checkpoints', (c) => c.agent_id === agentId || c.user_id === agentId)
  if (existing) return existing
  const epoch = '1970-01-01T00:00:00.000Z'
  const checkpoint = {
    id: uuidv4(),
    user_id: agentId,
    agent_id: agentId,
    checkpoints: {
      saved_searches: epoch,
      inquiries: epoch,
      viewings: epoch,
    },
    last_run_at: null,
    created_at: new Date().toISOString(),
  }
  await insert('consumer_automation_checkpoints', checkpoint)
  return checkpoint
}

async function updateAutomationCheckpoint(agentId, updates) {
  const existing = await findOne('consumer_automation_checkpoints', (c) => c.agent_id === agentId || c.user_id === agentId)
  const nowIso = new Date().toISOString()
  const next = {
    ...(existing || {
      id: uuidv4(),
      user_id: agentId,
      agent_id: agentId,
      checkpoints: {},
      created_at: nowIso,
    }),
    user_id: agentId,
    agent_id: agentId,
    checkpoints: {
      ...(existing?.checkpoints || {}),
      ...updates,
    },
    last_run_at: nowIso,
    updated_at: nowIso,
  }
  if (existing) {
    await update('consumer_automation_checkpoints', (c) => c.id === existing.id, () => next)
  } else {
    await insert('consumer_automation_checkpoints', next)
  }
  return next
}

async function matchSavedSearchProperties(filters = {}) {
  const allProperties = await findAll('properties', async (p) => await isMarketplaceVisible(p))
  return allProperties.filter((p) => {
    if (filters.type && p.type !== filters.type) return false
    if (filters.city && !String(p.city || '').toLowerCase().includes(String(filters.city).toLowerCase())) return false
    if ((filters.propertyType || filters.property_type) && p.property_type !== (filters.propertyType || filters.property_type)) return false
    if (filters.minPrice && Number(p.price || 0) < Number(filters.minPrice)) return false
    if (filters.maxPrice && Number(p.price || 0) > Number(filters.maxPrice)) return false
    if (filters.bedrooms && Number(p.bedrooms || 0) < Number(filters.bedrooms)) return false
    return true
  })
}

function shouldRunSavedSearchAlert(search, now = new Date()) {
  if (!(search.alert_enabled ?? true)) return false
  const frequency = search.alert_frequency || 'daily'
  const lastRun = search.last_alert_run_at ? new Date(search.last_alert_run_at) : null
  if (!lastRun || Number.isNaN(lastRun.getTime())) return true

  if (frequency === 'instant') return true
  if (frequency === 'daily') return now.getTime() - lastRun.getTime() >= 24 * 60 * 60 * 1000
  if (frequency === 'weekly') return now.getTime() - lastRun.getTime() >= 7 * 24 * 60 * 60 * 1000
  return true
}

async function runSavedSearchAlertsForUser(userId, { force = false, checkpoint = null } = {}) {
  const now = new Date()
  const nowIso = now.toISOString()
  const checkpointTs = checkpoint || '1970-01-01T00:00:00.000Z'
  const rows = await findAll('saved_searches', s => s.user_id === userId && (s.alert_enabled ?? true))

  const results = await Promise.all(rows
    .filter((search) => {
      if (force) return true
      if (shouldRunSavedSearchAlert(search, now)) return true
      const lastUpdate = search.updated_at || search.created_at || '1970-01-01T00:00:00.000Z'
      return lastUpdate > checkpointTs
    })
    .map(async (search) => {
      const matches = await matchSavedSearchProperties(search.filters || {})
      await update('saved_searches', s => s.id === search.id, (s) => ({
        ...s,
        last_alert_run_at: nowIso,
        last_match_count: matches.length,
        updated_at: nowIso,
      }))

      if (matches.length > 0) {
        await createNotification({
          userId,
          type: 'saved_search_match',
          title: `Saved search match: ${search.name}`,
          body: `${matches.length} listing${matches.length === 1 ? '' : 's'} matched your criteria.`,
          severity: 'info',
          meta: {
            saved_search_id: search.id,
            alert_channel: search.alert_channel || 'inapp',
            alert_frequency: search.alert_frequency || 'daily',
            top_matches: matches.slice(0, 5).map((p) => ({ id: p.id, title: p.title, city: p.city, price: p.price })),
          },
        })
      }

      return {
        saved_search_id: search.id,
        name: search.name,
        alert_channel: search.alert_channel || 'inapp',
        alert_frequency: search.alert_frequency || 'daily',
        match_count: matches.length,
        top_matches: matches.slice(0, 5).map((p) => ({
          id: p.id,
          title: p.title,
          city: p.city,
          price: p.price,
          type: p.type,
          property_type: p.property_type,
        })),
      }
    }))

  return {
    searches_processed: results.length,
    total_matches: results.reduce((sum, r) => sum + r.match_count, 0),
    results,
  }
}

async function runInquirySlaAutomation({ userId, checkpoint = null, force = false } = {}) {
  const nowMs = Date.now()
  const checkpointTs = checkpoint || '1970-01-01T00:00:00.000Z'
  const rows = await findAll('inquiries', (i) => {
    if (i.status !== 'new') return false
    if (!i.response_due_at) return false
    if (i.first_response_at) return false
    if (userId && i.agent_id !== userId && i.assigned_to !== userId) return false
    if (!force) {
      const lastUpdate = i.updated_at || i.created_at || '1970-01-01T00:00:00.000Z'
      if (lastUpdate <= checkpointTs) return false
    }
    return new Date(i.response_due_at).getTime() <= nowMs
  })

  for (const inquiry of rows) {
    const alreadyAlerted = Boolean(inquiry.sla_alert_sent_at)
    await update('inquiries', (i) => i.id === inquiry.id, (i) => ({
      ...i,
      sla_overdue: true,
      sla_alert_sent_at: i.sla_alert_sent_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    if (!alreadyAlerted && inquiry.agent_id) {
      await createNotification({
        userId: inquiry.agent_id,
        type: 'inquiry_sla_overdue',
        title: 'Inquiry SLA overdue',
        body: `Inquiry from ${inquiry.name} is overdue for first response.`,
        severity: 'warning',
        meta: { inquiry_id: inquiry.id, property_id: inquiry.property_id, due_at: inquiry.response_due_at },
      })
      await logActivity({
        type: 'inquiry_sla_overdue',
        property_id: inquiry.property_id,
        agent_id: inquiry.agent_id,
        meta: { inquiry_id: inquiry.id, due_at: inquiry.response_due_at },
      })
    }
  }

  return { overdue_marked: rows.length }
}

async function runViewingAutomation({ userId, checkpoint = null, force = false, now = new Date() } = {}) {
  // Viewings are always evaluated because time windows change continuously.
  // The checkpoint is recorded for observability but does not filter records.
  const nowMs = now.getTime()
  const noShowGraceMs = VIEWING_NO_SHOW_GRACE_MINUTES * 60 * 1000

  const scheduledRows = await findAll('viewings', (v) => {
    if (!['scheduled', 'confirmed'].includes(v.status)) return false
    if (userId && v.agent_id !== userId) return false
    return true
  })

  let remindersSent = 0
  let noShowsMarked = 0

  for (const viewing of scheduledRows) {
    const scheduledAtMs = new Date(viewing.scheduled_at).getTime()
    if (Number.isNaN(scheduledAtMs)) continue

    const agent = viewing.agent_id ? await findOne('agents', a => a.id === viewing.agent_id) : null
    const agencyId = agent ? ((await findOne('agency_members', m => m.user_id === agent.id && m.status === 'active'))?.agency_id || null) : null
    const policy = await resolveReminderPolicy({ appointmentType: 'viewing', agentId: viewing.agent_id, agencyId })

    const dueReminders = await evaluateReminderPolicy({
      policy,
      scheduledAt: viewing.scheduled_at,
      referenceTime: now,
      remindersSent: viewing.reminders_sent,
    })

    for (const reminder of dueReminders) {
      for (const channel of reminder.channels) {
        if (channel === 'inapp') {
          await createNotification({
            userId: viewing.agent_id,
            type: 'viewing_reminder',
            title: 'Upcoming viewing reminder',
            body: `Viewing with ${viewing.client_name || 'client'} at ${new Date(viewing.scheduled_at).toLocaleString()}.`,
            severity: 'info',
            meta: { viewing_id: viewing.id, inquiry_id: viewing.inquiry_id, scheduled_at: viewing.scheduled_at, policy_id: policy.id, offset_minutes: reminder.offset_minutes },
          })
        }
        // Email and WhatsApp reminders can be wired through the orchestrator once
        // outbound dispatch for these channels is required.
      }
      await markReminderSent(viewing, reminder)
      remindersSent += 1
    }

    // No-show automation: scheduled/confirmed and sufficiently in the past.
    const shouldMarkNoShow = scheduledAtMs < (nowMs - noShowGraceMs)
    if (shouldMarkNoShow) {
      await update('viewings', (v) => v.id === viewing.id, (v) => ({
        ...v,
        status: 'no_show',
        auto_marked_no_show_at: now.toISOString(),
        updated_at: now.toISOString(),
      }))
      if (viewing.inquiry_id) {
        await update('inquiries', (i) => i.id === viewing.inquiry_id, (i) => ({
          ...i,
          stage: 'viewing',
          status: i.status === 'scheduled_viewing' ? 'contacted' : i.status,
          next_follow_up_at: new Date(nowMs + 2 * 60 * 60 * 1000).toISOString(),
          updated_at: now.toISOString(),
        }))
      }
      if (viewing.agent_id) {
        await createNotification({
          userId: viewing.agent_id,
          type: 'viewing_no_show',
          title: 'Viewing marked as no-show',
          body: `Viewing with ${viewing.client_name || 'client'} was auto-marked no-show after grace window.`,
          severity: 'warning',
          meta: { viewing_id: viewing.id, inquiry_id: viewing.inquiry_id },
        })
      }
      await logActivity({
        type: 'viewing_auto_no_show',
        property_id: viewing.property_id,
        agent_id: viewing.agent_id,
        meta: { viewing_id: viewing.id, inquiry_id: viewing.inquiry_id, scheduled_at: viewing.scheduled_at },
      })
      noShowsMarked += 1
    }
  }

  return { reminders_sent: remindersSent, no_shows_marked: noShowsMarked }
}

async function processConsumerJourneyAutomation({ agentId = null, forceAlerts = false, source = 'worker_scheduler', requestedBy = 'system' } = {}) {
  const targetUserIds = agentId
    ? [agentId]
    : Array.from(new Set([
      ...(await findAll('saved_searches')).map((s) => s.user_id).filter(Boolean),
      ...(await findAll('inquiries')).map((i) => i.agent_id).filter(Boolean),
      ...(await findAll('viewings')).map((v) => v.agent_id).filter(Boolean),
    ]))

  const summary = {
    users_processed: 0,
    users_skipped_by_checkpoint: 0,
    searches_processed: 0,
    total_matches: 0,
    inquiry_overdue_marked: 0,
    reminders_sent: 0,
    no_shows_marked: 0,
  }
  const perUserMetrics = []

  for (const userId of targetUserIds) {
    const checkpoint = await getAutomationCheckpoint(userId)
    const nowIso = new Date().toISOString()

    // Simple checkpoint gate: skip redundant back-to-back runs unless forced.
    const lastRunMs = checkpoint.last_run_at ? new Date(checkpoint.last_run_at).getTime() : 0
    const minIntervalMs = 5000
    if (!forceAlerts && (Date.now() - lastRunMs) < minIntervalMs) {
      summary.users_skipped_by_checkpoint += 1
      perUserMetrics.push({ user_id: userId, skipped: true, reason: 'recent_run' })
      continue
    }

    const savedSearchCheckpoint = checkpoint.checkpoints?.saved_searches
    const inquiryCheckpoint = checkpoint.checkpoints?.inquiries

    const savedSearchRun = await runSavedSearchAlertsForUser(userId, { force: forceAlerts, checkpoint: savedSearchCheckpoint })
    const inquiryRun = await runInquirySlaAutomation({ userId, checkpoint: inquiryCheckpoint, force: forceAlerts })
    const viewingRun = await runViewingAutomation({ userId, checkpoint: checkpoint.checkpoints?.viewings, force: forceAlerts })

    await updateAutomationCheckpoint(userId, {
      saved_searches: nowIso,
      inquiries: nowIso,
      viewings: nowIso,
    })

    summary.users_processed += 1
    summary.searches_processed += savedSearchRun.searches_processed
    summary.total_matches += savedSearchRun.total_matches
    summary.inquiry_overdue_marked += inquiryRun.overdue_marked
    summary.reminders_sent += viewingRun.reminders_sent
    summary.no_shows_marked += viewingRun.no_shows_marked
    perUserMetrics.push({
      user_id: userId,
      skipped: false,
      searches_processed: savedSearchRun.searches_processed,
      total_matches: savedSearchRun.total_matches,
      inquiry_overdue_marked: inquiryRun.overdue_marked,
      reminders_sent: viewingRun.reminders_sent,
      no_shows_marked: viewingRun.no_shows_marked,
    })
  }

  await logActivity({
    type: 'consumer_automation_run',
    agent_id: agentId,
    meta: { ...summary, source, requested_by: requestedBy, per_user: perUserMetrics },
  })

  // Update rolling metrics state
  consumerAutomationState.metrics.total_runs += 1
  consumerAutomationState.metrics.total_users_processed += summary.users_processed
  consumerAutomationState.metrics.total_searches_processed += summary.searches_processed
  consumerAutomationState.metrics.total_matches += summary.total_matches
  consumerAutomationState.metrics.total_inquiry_overdue_marked += summary.inquiry_overdue_marked
  consumerAutomationState.metrics.total_reminders_sent += summary.reminders_sent
  consumerAutomationState.metrics.total_no_shows_marked += summary.no_shows_marked

  const runRecord = {
    ran_at: new Date().toISOString(),
    source,
    requested_by: requestedBy,
    summary,
    per_user: perUserMetrics,
  }
  consumerAutomationState.run_history.unshift(runRecord)
  consumerAutomationState.run_history = consumerAutomationState.run_history.slice(0, 100)

  return summary
}

// ==================== SAVED SEARCHES ====================
app.get('/api/saved-searches', authMiddleware, async (req, res) => {
  res.json(
    (await findAll('saved_searches', s => s.user_id === req.user.id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  )
})

app.post('/api/saved-searches', authMiddleware, validate(savedSearchCreateSchema), async (req, res) => {
  const body = req.validated
  const ss = {
    id: uuidv4(),
    user_id: req.user.id,
    name: body.name,
    filters: body.filters || {},
    alert_enabled: body.alert_enabled,
    alert_channel: body.alert_channel,
    alert_frequency: body.alert_frequency,
    last_alert_run_at: null,
    last_match_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await insert('saved_searches', ss)
  res.json(ss)
})

app.patch('/api/saved-searches/:id', authMiddleware, validate(savedSearchUpdateSchema), async (req, res) => {
  const row = await findOne('saved_searches', s => s.id === req.params.id && s.user_id === req.user.id)
  if (!row) return res.status(404).json({ error: 'Saved search not found' })

  const patch = req.validated
  const next = {
    ...row,
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.filters !== undefined && { filters: patch.filters }),
    ...(patch.alert_enabled !== undefined && { alert_enabled: patch.alert_enabled }),
    ...(patch.alert_channel !== undefined && { alert_channel: patch.alert_channel }),
    ...(patch.alert_frequency !== undefined && { alert_frequency: patch.alert_frequency }),
    updated_at: new Date().toISOString(),
  }
  await update('saved_searches', s => s.id === row.id, () => next)
  res.json(next)
})

app.post('/api/saved-searches/run-alerts', authMiddleware, async (req, res) => {
  const result = await runSavedSearchAlertsForUser(req.user.id, { force: true })

  await logActivity({
    type: 'saved_search_alerts_run',
    agent_id: req.user.id,
    meta: {
      searches: result.searches_processed,
      total_matches: result.total_matches,
      source: 'manual',
    },
  })

  res.json({
    ran_at: new Date().toISOString(),
    searches_processed: result.searches_processed,
    total_matches: result.total_matches,
    results: result.results,
  })
})

app.get('/api/notifications', authMiddleware, validateQuery(notificationQuerySchema), async (req, res) => {
  const q = req.validatedQuery
  let rows = await findAll('consumer_notifications', (n) => n.user_id === req.user.id)
  if (q.unread_only === 'true' || q.unread_only === '1') {
    rows = rows.filter((n) => !n.read)
  }
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  let startIndex = 0
  if (q.cursor) {
    const idx = rows.findIndex((n) => n.id === q.cursor)
    startIndex = idx >= 0 ? idx + 1 : rows.length
  }
  const items = rows.slice(startIndex, startIndex + q.limit)
  const nextCursor = items.length === q.limit ? items[items.length - 1].id : null
  res.json({ items, next_cursor: nextCursor, has_more: !!nextCursor })
})

app.post('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  const row = await findOne('consumer_notifications', (n) => n.id === req.params.id && n.user_id === req.user.id)
  if (!row) return res.status(404).json({ error: 'Notification not found' })
  await update('consumer_notifications', (n) => n.id === row.id, (n) => ({ ...n, read: true, read_at: new Date().toISOString() }))
  res.json({ success: true })
})

app.post('/api/notifications/:id/retry', authMiddleware, async (req, res) => {
  const notification = await findOne('consumer_notifications', (n) => n.id === req.params.id && n.user_id === req.user.id)
  if (!notification) return res.status(404).json({ error: 'Notification not found' })
  if (!notification.dispatch || notification.dispatch.channel === 'inapp') {
    return res.json({ success: true, status: 'delivered', note: 'In-app notifications do not require external dispatch.' })
  }
  const result = await dispatchNotification(notification)
  const now = new Date().toISOString()
  await update('consumer_notifications', (n) => n.id === notification.id, (n) => ({
    ...n,
    dispatch: {
      ...n.dispatch,
      status: result.ok ? result.status : 'failed',
      last_error: result.ok ? null : result.error,
      attempts: (n.dispatch?.attempts || 0) + 1,
      sent_at: result.ok ? now : n.dispatch?.sent_at,
      delivered_at: result.ok ? now : n.dispatch?.delivered_at,
    },
  }))
  res.json({ success: result.ok, status: result.status, error: result.error })
})

app.get('/api/admin/notifications/dead-letter', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const dead = (await findAll('consumer_notification_retries', (r) => r.status === 'failed'))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  res.json({ items: dead, total: dead.length })
})

app.post('/api/admin/notifications/retry-pending', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const result = await processPendingNotificationRetries({ limit: Number(req.body?.limit || 20) })
  res.json(result)
})

app.get('/api/notification-preferences', authMiddleware, async (req, res) => {
  const prefs = await getOrCreateNotificationPrefs(req.user.id)
  res.json(serializeNotificationPrefs(prefs))
})

app.patch('/api/notification-preferences', authMiddleware, validate(notificationPrefsUpdateSchema), async (req, res) => {
  const current = await getOrCreateNotificationPrefs(req.user.id)
  const patch = req.validated
  const next = {
    ...current,
    channels: { ...current.channels, ...patch.channels },
    event_toggles: { ...current.event_toggles, ...patch.events },
    quiet_hours: { ...current.quiet_hours, ...patch.quiet_hours },
    updated_at: new Date().toISOString(),
  }
  await update('consumer_notification_prefs', (p) => p.id === current.id, () => next)
  res.json(serializeNotificationPrefs(next))
})

// ==================== CONTACTS ====================
app.get('/api/contacts', authMiddleware, async (req, res) => {
  const mine = (await findAll('contacts', (c) => c.assigned_agent_id === req.user.id))
    .sort((a, b) => new Date(b.last_activity_at || b.created_at).getTime() - new Date(a.last_activity_at || a.created_at).getTime())
  res.json(mine)
})

app.get('/api/contacts/:id', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const inquiries = await findAll('inquiries', (i) => i.contact_id === contact.id)
  const viewings = await findAll('viewings', (v) => v.contact_id === contact.id)
  const conversations = await findAll('conversations', (c) => c.contact_id === contact.id)
  res.json({ ...contact, inquiries, viewings, conversations })
})

app.patch('/api/contacts/:id', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const allowed = ['name', 'email', 'phone', 'tags', 'status', 'assigned_agent_id']
  const patch = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }
  if (patch.email) patch.email = normalizeEmail(patch.email)
  if (patch.phone) patch.phone = normalizePhone(patch.phone)
  await update('contacts', (c) => c.id === contact.id, (c) => ({ ...c, ...patch, updated_at: new Date().toISOString() }))
  res.json(await findOne('contacts', (c) => c.id === contact.id))
})

app.post('/api/contacts/:id/merge', authMiddleware, async (req, res) => {
  const source = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  const target = await findOne('contacts', (c) => c.id === req.body.target_contact_id && c.assigned_agent_id === req.user.id)
  if (!source || !target) return res.status(404).json({ error: 'Source or target contact not found' })
  try {
    const merged = await mergeContacts(source.id, target.id)
    await logActivity({
      type: 'contacts_merged',
      agent_id: req.user.id,
      meta: { source_id: source.id, target_id: target.id, merged_contact_id: merged.id },
    })
    res.json(merged)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ==================== GDPR & DATA SUBJECT RIGHTS ====================
async function exportContactData(contactId) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return null
  const collections = ['inquiries', 'viewings', 'conversation_messages', 'conversations', 'tasks', 'opportunities', 'contact_notes', 'campaign_enrollments', 'campaign_messages', 'activity_log', 'consumer_notifications']
  const related = {}
  for (const collection of collections) {
    related[collection] = await findAll(collection, (r) => r.contact_id === contactId || r.user_id === contactId)
  }
  return { contact, related, exported_at: new Date().toISOString() }
}

async function deleteContactData(contactId) {
  const contact = await findOne('contacts', (c) => c.id === contactId)
  if (!contact) return null
  await remove('conversation_messages', (m) => m.contact_id === contactId)
  await remove('conversations', (c) => c.contact_id === contactId)
  await remove('inquiries', (i) => i.contact_id === contactId)
  await remove('viewings', (v) => v.contact_id === contactId)
  await remove('tasks', (t) => t.contact_id === contactId)
  await remove('opportunities', (o) => o.contact_id === contactId)
  await remove('contact_notes', (n) => n.contact_id === contactId)
  await remove('campaign_enrollments', (e) => e.contact_id === contactId)
  await remove('campaign_messages', (m) => m.contact_id === contactId)
  await remove('contacts', (c) => c.id === contactId)
  return { deleted: true, contact_id: contactId }
}

app.delete('/api/contacts/:id', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const result = await deleteContactData(contact.id)
  await logActivity({ type: 'contact_deleted', agent_id: req.user.id, meta: { contact_id: contact.id } })
  res.json(result)
})

app.get('/api/contacts/:id/export', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const exportData = await exportContactData(contact.id)
  await logActivity({ type: 'contact_exported', agent_id: req.user.id, meta: { contact_id: contact.id } })
  res.set('Content-Disposition', `attachment; filename="contact-${contact.id}-export.json"`)
  res.set('Content-Type', 'application/json')
  res.json(exportData)
})

// ==================== AUDIT LOG & RETENTION ====================
app.get('/api/admin/audit-log', authMiddleware, requireAdmin, async (req, res) => {
  let rows = await findAll('activity_log')
  if (req.query.agent_id) rows = rows.filter((r) => r.agent_id === req.query.agent_id)
  if (req.query.type) rows = rows.filter((r) => r.type === req.query.type)
  if (req.query.from) rows = rows.filter((r) => r.created_at >= req.query.from)
  if (req.query.to) rows = rows.filter((r) => r.created_at <= req.query.to)
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100))
  res.json({ items: rows.slice(0, limit), total: rows.length })
})

app.post('/api/admin/audit-log/retention', authMiddleware, requirePlatformAdmin, async (req, res) => {
  const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const activityCutoff = new Date(Date.now() - ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  let removed = 0
  let activityRemoved = 0
  try {
    removed = await remove('audit_log', (r) => r.created_at && r.created_at < cutoff)
  } catch (err) {
    logger.warn({ err: err.message }, 'audit_log collection may not exist; skipping retention cleanup')
  }
  try {
    activityRemoved = await remove('activity_log', (r) => r.created_at && r.created_at < activityCutoff)
  } catch (err) {
    logger.warn({ err: err.message }, 'activity_log retention cleanup warning')
  }
  await logActivity({ type: 'audit_log_retention_run', agent_id: req.user.id, meta: { removed_audit_log: removed, removed_activity_log: activityRemoved, audit_retention_days: AUDIT_LOG_RETENTION_DAYS, activity_retention_days: ACTIVITY_LOG_RETENTION_DAYS } })
  res.json({ removed_audit_log: removed, removed_activity_log: activityRemoved, audit_retention_days: AUDIT_LOG_RETENTION_DAYS, activity_retention_days: ACTIVITY_LOG_RETENTION_DAYS })
})

app.post('/api/admin/users/:id/promote', authMiddleware, requirePlatformAdmin, async (req, res) => {
  const user = await findUserById(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const platformRole = req.body.role === null || req.body.role === 'none'
    ? null
    : req.body.role
  if (platformRole !== null && platformRole !== 'platform_admin') {
    return res.status(400).json({ error: 'role must be platform_admin or null' })
  }
  await updatePlatformRole(user.id, platformRole)
  await logActivity({
    type: platformRole ? 'platform_role_granted' : 'platform_role_revoked',
    agent_id: req.user.id,
    meta: { target_user_id: req.params.id, platform_role: platformRole },
  })
  res.json({ success: true, platform_role: platformRole })
})

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// ==================== REMINDER POLICIES ====================
app.get('/api/reminder-policies', authMiddleware, async (req, res) => {
  res.json(await getReminderPolicies({
    ownerType: req.query.owner_type,
    ownerId: req.query.owner_id || req.user.id,
    appointmentType: req.query.appointment_type,
  }))
})

app.post('/api/reminder-policies', authMiddleware, async (req, res) => {
  try {
    const ownerType = req.body.owner_type || 'agent'
    const ownerId = ownerType === 'agent' ? req.user.id : req.body.owner_id
    if (ownerType === 'agency') {
      const member = await findOne('agency_members', m => m.agency_id === ownerId && m.user_id === req.user.id && m.status === 'active')
      if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Forbidden' })
    }
    const policy = await createReminderPolicy({
      name: req.body.name,
      ownerType,
      ownerId,
      appointmentType: req.body.appointment_type,
      rules: req.body.rules || [],
      isDefault: req.body.is_default,
    })
    await logActivity({ type: 'reminder_policy_created', agent_id: req.user.id, meta: { policy_id: policy.id, appointment_type: policy.appointment_type } })
    res.status(201).json(policy)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/reminder-policies/:id', authMiddleware, async (req, res) => {
  const policy = await getReminderPolicyById(req.params.id)
  if (!policy) return res.status(404).json({ error: 'Not found' })
  if (policy.owner_type === 'agent' && policy.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  if (policy.owner_type === 'agency') {
    const member = await findOne('agency_members', m => m.agency_id === policy.owner_id && m.user_id === req.user.id && m.status === 'active')
    if (!member) return res.status(403).json({ error: 'Forbidden' })
  }
  res.json(policy)
})

app.patch('/api/reminder-policies/:id', authMiddleware, async (req, res) => {
  const policy = await getReminderPolicyById(req.params.id)
  if (!policy) return res.status(404).json({ error: 'Not found' })
  if (policy.owner_type === 'agent' && policy.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  if (policy.owner_type === 'agency') {
    const member = await findOne('agency_members', m => m.agency_id === policy.owner_id && m.user_id === req.user.id && m.status === 'active')
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const updated = await updateReminderPolicy(req.params.id, req.body)
    await logActivity({ type: 'reminder_policy_updated', agent_id: req.user.id, meta: { policy_id: req.params.id } })
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.delete('/api/reminder-policies/:id', authMiddleware, async (req, res) => {
  const policy = await getReminderPolicyById(req.params.id)
  if (!policy) return res.status(404).json({ error: 'Not found' })
  if (policy.owner_type === 'agent' && policy.owner_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  if (policy.owner_type === 'agency') {
    const member = await findOne('agency_members', m => m.agency_id === policy.owner_id && m.user_id === req.user.id && m.status === 'active')
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Forbidden' })
  }
  await deleteReminderPolicy(req.params.id)
  await logActivity({ type: 'reminder_policy_deleted', agent_id: req.user.id, meta: { policy_id: req.params.id } })
  res.json({ success: true })
})

// ==================== MESSAGE TEMPLATES ====================
app.get('/api/message-templates', authMiddleware, async (req, res) => {
  const agentId = req.user.id
  const agencyId = await getActiveAffiliation(agentId)?.agency_id || null
  const rows = await getTemplatesForAgent({ agentId, agencyId, channel: req.query.channel, category: req.query.category })
  res.json(rows)
})

app.get('/api/message-templates/defaults', authMiddleware, async (req, res) => {
  const rows = await getDefaultTemplates({ channel: req.query.channel, category: req.query.category })
  res.json(rows)
})

app.get('/api/message-templates/:id', authMiddleware, async (req, res) => {
  const template = await getTemplateById(req.params.id)
  if (!template) return res.status(404).json({ error: 'Template not found' })
  res.json(template)
})

app.post('/api/message-templates', authMiddleware, validate(messageTemplateCreateSchema), async (req, res) => {
  const body = req.validated
  const agentId = req.user.id
  const agencyId = await getActiveAffiliation(agentId)?.agency_id || null

  let ownerType = body.owner_type || 'agent'
  let ownerId = body.owner_id || agentId

  if (ownerType === 'platform' && req.user.platform_role !== 'platform_admin') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  if (ownerType === 'agency') {
    if (!agencyId || ownerId !== agencyId) return res.status(403).json({ error: 'Forbidden' })
  }
  if (ownerType === 'agent' && ownerId !== agentId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  try {
    const template = await createTemplate({
      name: body.name,
      channel: body.channel,
      category: body.category,
      subject: body.subject,
      body: body.body,
      language: body.language,
      approvalStatus: body.approval_status,
      ownerType,
      ownerId,
      isDefault: body.is_default,
      createdBy: agentId,
    })
    await logActivity({ type: 'message_template_created', agent_id: agentId, meta: { template_id: template.id, channel: template.channel } })
    res.json(template)
  } catch (e) {
    res.status(400).json({ error: e.message, code: e.code })
  }
})

app.patch('/api/message-templates/:id', authMiddleware, validate(messageTemplateUpdateSchema), async (req, res) => {
  const template = await getTemplateById(req.params.id)
  if (!template) return res.status(404).json({ error: 'Template not found' })
  const agentId = req.user.id
  const agencyId = await getActiveAffiliation(agentId)?.agency_id || null

  const canEdit =
    (template.owner_type === 'agent' && template.owner_id === agentId) ||
    (template.owner_type === 'agency' && template.owner_id === agencyId) ||
    (template.owner_type === 'platform' && req.user.platform_role === 'platform_admin')

  if (!canEdit) return res.status(403).json({ error: 'Forbidden' })

  try {
    const updated = await updateTemplate(req.params.id, req.validated)
    await logActivity({ type: 'message_template_updated', agent_id: agentId, meta: { template_id: updated.id } })
    res.json(updated)
  } catch (e) {
    res.status(400).json({ error: e.message, code: e.code })
  }
})

app.delete('/api/message-templates/:id', authMiddleware, async (req, res) => {
  const template = await getTemplateById(req.params.id)
  if (!template) return res.status(404).json({ error: 'Template not found' })
  const agentId = req.user.id
  const agencyId = await getActiveAffiliation(agentId)?.agency_id || null

  const canDelete =
    (template.owner_type === 'agent' && template.owner_id === agentId) ||
    (template.owner_type === 'agency' && template.owner_id === agencyId) ||
    (template.owner_type === 'platform' && req.user.platform_role === 'platform_admin')

  if (!canDelete) return res.status(403).json({ error: 'Forbidden' })

  await deleteTemplate(req.params.id)
  await logActivity({ type: 'message_template_deleted', agent_id: agentId, meta: { template_id: req.params.id } })
  res.json({ success: true })
})

app.post('/api/message-templates/:id/render', authMiddleware, validate(messageTemplateRenderSchema), async (req, res) => {
  const template = await getTemplateById(req.params.id)
  if (!template) return res.status(404).json({ error: 'Template not found' })
  const rendered = await renderTemplate(template, req.validated.variables || {})
  res.json(rendered)
})

// ==================== CONVERSATIONS ====================
app.get('/api/conversations', authMiddleware, async (req, res) => {
  const mine = (await findAll('conversations', (c) => c.assigned_agent_id === req.user.id))
    .sort((a, b) => new Date(b.last_message_at || b.created_at).getTime() - new Date(a.last_message_at || a.created_at).getTime())
  res.json(mine)
})

app.get('/api/conversations/:id', authMiddleware, async (req, res) => {
  const conversation = await findOne('conversations', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const messages = (await findAll('conversation_messages', (m) => m.conversation_id === conversation.id))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const contact = await findOne('contacts', (c) => c.id === conversation.contact_id)
  res.json({ ...conversation, messages, contact })
})

app.post('/api/conversations/:id/messages', authMiddleware, async (req, res) => {
  const conversation = await findOne('conversations', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const content = String(req.body.content || '').trim()
  if (!content) return res.status(400).json({ error: 'Message content is required' })

  try {
    const { message, dispatch } = await sendOutboundMessage({
      conversationId: conversation.id,
      content,
      contentType: req.body.content_type || 'text',
      imageUrl: req.body.image_url,
      sentByAgentId: req.user.id,
      subject: req.body.subject,
    })
    await logActivity({
      type: 'conversation_message_sent',
      agent_id: req.user.id,
      meta: { conversation_id: conversation.id, message_id: message.id, channel: conversation.source_channel },
    })
    res.json({ message, dispatch })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/conversations/:id/assign', authMiddleware, async (req, res) => {
  const conversation = await findOne('conversations', (c) => c.id === req.params.id)
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const agentId = req.body.agent_id || req.user.id
  const updated = await assignConversation(conversation.id, agentId)
  await logActivity({
    type: 'conversation_assigned',
    agent_id: req.user.id,
    meta: { conversation_id: conversation.id, assigned_to: agentId },
  })
  res.json(updated)
})

app.patch('/api/conversations/:id', authMiddleware, async (req, res) => {
  const conversation = await findOne('conversations', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const allowed = ['status', 'priority', 'subject']
  const patch = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }
  await update('conversations', (c) => c.id === conversation.id, (c) => ({ ...c, ...patch, updated_at: new Date().toISOString() }))
  res.json(await findOne('conversations', (c) => c.id === conversation.id))
})

app.post('/api/conversations/:id/close', authMiddleware, async (req, res) => {
  const conversation = await findOne('conversations', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const updated = await closeConversation(conversation.id, req.body.reason || '')
  await logActivity({
    type: 'conversation_closed',
    agent_id: req.user.id,
    meta: { conversation_id: conversation.id },
  })
  res.json(updated)
})

app.post('/api/conversations/:id/read', authMiddleware, async (req, res) => {
  const conversation = await findOne('conversations', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
  const updated = await markConversationReadByAgent(conversation.id)
  res.json(updated)
})

// ==================== TASKS ====================
app.get('/api/tasks', authMiddleware, validateQuery(taskQuerySchema), async (req, res) => {
  const q = req.validatedQuery
  let rows = await getTasks({ assignedTo: req.user.id, status: q.status, dueBefore: q.due_before, dueAfter: q.due_after })
  rows.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
  let startIndex = 0
  if (q.cursor) {
    const idx = rows.findIndex((t) => t.id === q.cursor)
    startIndex = idx >= 0 ? idx + 1 : rows.length
  }
  const items = rows.slice(startIndex, startIndex + q.limit)
  const nextCursor = items.length === q.limit ? items[items.length - 1].id : null
  res.json({ items, next_cursor: nextCursor, has_more: !!nextCursor })
})

app.post('/api/tasks', authMiddleware, validate(taskCreateSchema), async (req, res) => {
  const body = req.validated
  const task = await createTask({
    contactId: body.contact_id,
    inquiryId: body.inquiry_id,
    opportunityId: body.opportunity_id,
    conversationId: body.conversation_id,
    assignedTo: body.assigned_to || req.user.id,
    type: body.type,
    title: body.title,
    notes: body.notes,
    dueAt: body.due_at,
    priority: body.priority,
    createdBy: req.user.id,
  })
  if (body.inquiry_id) await syncInquiryNextFollowUp(body.inquiry_id)
  await logActivity({
    type: 'task_created',
    agent_id: req.user.id,
    meta: { task_id: task.id, contact_id: task.contact_id, inquiry_id: task.inquiry_id },
  })
  res.json(task)
})

app.get('/api/tasks/:id', authMiddleware, async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id && t.assigned_to === req.user.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(task)
})

app.patch('/api/tasks/:id', authMiddleware, validate(taskUpdateSchema), async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id && t.assigned_to === req.user.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  const updated = await updateTask(task.id, req.validated)
  if (updated?.inquiry_id) await syncInquiryNextFollowUp(updated.inquiry_id)
  await logActivity({
    type: 'task_updated',
    agent_id: req.user.id,
    meta: { task_id: updated.id, inquiry_id: updated.inquiry_id },
  })
  res.json(updated)
})

app.post('/api/tasks/:id/complete', authMiddleware, async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id && t.assigned_to === req.user.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  const updated = await completeTask(task.id, { completedBy: req.user.id })
  if (updated?.inquiry_id) await syncInquiryNextFollowUp(updated.inquiry_id)
  await logActivity({
    type: 'task_completed',
    agent_id: req.user.id,
    meta: { task_id: updated.id, inquiry_id: updated.inquiry_id },
  })
  res.json(updated)
})

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id && t.assigned_to === req.user.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  await deleteTask(task.id)
  if (task.inquiry_id) await syncInquiryNextFollowUp(task.inquiry_id)
  res.json({ success: true })
})

// ==================== OPPORTUNITIES ====================
app.get('/api/opportunities', authMiddleware, async (req, res) => {
  const rows = await getOpportunities({ agentId: req.user.id, status: req.query.status, stage: req.query.stage })
  res.json(rows)
})

app.post('/api/opportunities', authMiddleware, validate(opportunityCreateSchema), async (req, res) => {
  const body = req.validated
  const agent = await findOne('agents', (a) => a.id === req.user.id)
  const opp = await createOpportunity({
    contactId: body.contact_id,
    propertyId: body.property_id,
    agentId: req.user.id,
    agencyId: agent?.agency_id || null,
    stage: body.stage,
    dealValue: body.deal_value,
    currency: body.currency,
    probability: body.probability,
    expectedCloseDate: body.expected_close_date,
    source: 'manual',
    notes: body.notes,
  })
  await logActivity({
    type: 'opportunity_created',
    agent_id: req.user.id,
    meta: { opportunity_id: opp.id, contact_id: opp.contact_id, stage: opp.stage },
  })
  res.json(opp)
})

app.get('/api/opportunities/:id', authMiddleware, async (req, res) => {
  const opp = await findOne('opportunities', (o) => o.id === req.params.id && o.agent_id === req.user.id)
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' })
  res.json({ ...opp, stage_history: await getStageHistory(opp.id) })
})

app.patch('/api/opportunities/:id', authMiddleware, validate(opportunityUpdateSchema), async (req, res) => {
  const opp = await findOne('opportunities', (o) => o.id === req.params.id && o.agent_id === req.user.id)
  if (!opp) return res.status(404).json({ error: 'Opportunity not found' })
  const updated = await updateOpportunity(opp.id, req.validated, { changedBy: req.user.id })
  await logActivity({
    type: 'opportunity_updated',
    agent_id: req.user.id,
    meta: { opportunity_id: updated.id, stage: updated.stage },
  })
  // Signal the frontend that a closure form should be shown — never
  // blocking. Frontend decides whether to prompt.
  const closureSignal = opp.stage !== 'closed_won' && updated.stage === 'closed_won'
    ? {
        should_prompt_closure_form: true,
        listing_id: updated.property_id || null,
        contact_id: updated.contact_id || null,
        opportunity_id: updated.id,
        deal_value_hint: updated.deal_value || null,
        currency_hint: updated.currency || 'USD',
      }
    : null
  res.json({ ...updated, closure_prompt: closureSignal })
})

/* ==============================================================
 * Closed transactions — AVM training data capture (task #6)
 *
 * DO NOT surface anywhere in the current agent UI beyond the
 * RecordClosureModal + Settings → Historical Transactions. This
 * data is training signal for a future AVM (Stage 3+); every day
 * of delay is transactions lost forever.
 * ============================================================== */

app.get('/api/closed-transactions/config', authMiddleware, (_req, res) => {
  res.json({
    transaction_types: TRANSACTION_TYPES,
    buyer_types: BUYER_TYPES,
    payment_methods: PAYMENT_METHODS,
    attribution_sources: ATTRIBUTION_SOURCES,
    close_reasons: CLOSE_REASONS,
  })
})

app.get('/api/closed-transactions', authMiddleware, async (req, res) => {
  const listingId = req.query.listing_id ? String(req.query.listing_id) : undefined
  const contactId = req.query.contact_id ? String(req.query.contact_id) : undefined
  const rows = await listClosedTransactions({
    agentId: req.user.id,
    listingId,
    contactId,
    limit: Math.min(500, Number(req.query.limit) || 200),
  })
  res.json({ transactions: rows })
})

app.get('/api/closed-transactions/:id', authMiddleware, async (req, res) => {
  const row = await getClosedTransaction(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  res.json(row)
})

app.post('/api/closed-transactions', authMiddleware, async (req, res) => {
  const body = req.body || {}
  // Only owner-scoped writes — agent_id / agency_id come from the token,
  // never from the client body.
  const agent = await findOne('agents', (a) => a.id === req.user.id)
  const agencyId = agent?.agency_id || null

  if (body.listing_id && !String(body.listing_id).startsWith('backfill:')) {
    const listing = await findOne('properties', (p) => p.id === body.listing_id)
    if (!listing) return res.status(404).json({ error: 'Listing not found' })
    if (listing.agent_id !== req.user.id) return res.status(403).json({ error: 'Not authorised for this listing' })
  }

  try {
    const row = await recordClosedTransaction({
      ...body,
      agent_id: req.user.id,
      agency_id: agencyId,
    })
    await logActivity({
      type: 'closed_transaction_recorded',
      agent_id: req.user.id,
      meta: {
        listing_id: row.listing_id,
        transaction_type: row.transaction_type,
        sold_price: row.final_sold_price,
        is_backfilled: row.is_backfilled,
      },
    })
    res.json(row)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.delete('/api/closed-transactions/:id', authMiddleware, async (req, res) => {
  const row = await getClosedTransaction(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  await deleteClosedTransaction(row.id)
  res.json({ ok: true })
})

/* ==============================================================
 * Contact 360 — unified per-contact conversation view + AI lead
 * summary + score + next steps (Phase 4.8).
 *
 * Uses Phase 4.7 per-message categorisation and the Phase 3
 * multi-provider AI adapter. Score is deterministic (weighted
 * category rollup, cache-free). Summary + next steps are cached
 * in contact_lead_summaries with staleness detection.
 * ============================================================== */

app.get('/api/contact-360/config', authMiddleware, (_req, res) => {
  res.json({ category_weights: CATEGORY_WEIGHTS })
})

/* ==============================================================
 * Per-listing Performance dashboard (Phase 4.9). Aggregates
 * distributions + insight snapshots + inquiries + messages +
 * viewings + closed transactions into a full channel-level view.
 * ============================================================== */
app.get('/api/listings/:id/performance', authMiddleware, async (req, res) => {
  const days = Math.max(7, Math.min(90, Number(req.query.days) || 30))
  const bundle = await resolveListingPerformance(req.params.id, req.user.id, { days })
  if (bundle.error) {
    const code = bundle.error === 'Listing not found' ? 404 : 403
    return res.status(code).json({ error: bundle.error })
  }
  res.json(bundle)
})

app.get('/api/contacts/:id/conversations-360', authMiddleware, async (req, res) => {
  const feed = await resolveContact360Feed(req.params.id, req.user.id)
  if (feed.error) {
    const code = feed.error === 'Contact not found' ? 404 : 403
    return res.status(code).json({ error: feed.error })
  }
  res.json(feed)
})

app.get('/api/contacts/:id/lead-score', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  if (contact.assigned_agent_id !== req.user.id) return res.status(403).json({ error: 'Not authorised' })
  const score = await computeLeadScore(req.params.id)
  res.json(score)
})

app.get('/api/contacts/:id/lead-summary', authMiddleware, async (req, res) => {
  const bundle = await getLeadSummary({ contactId: req.params.id, requesterAgentId: req.user.id })
  if (bundle.error) {
    const code = bundle.error === 'Contact not found' ? 404 : 403
    return res.status(code).json({ error: bundle.error })
  }
  res.json(bundle)
})

app.post('/api/contacts/:id/regenerate-summary', authMiddleware, async (req, res) => {
  const aiAdapter = listingsAiModule?.enabled ? listingsAiModule.aiAdapter : null
  if (!aiAdapter) {
    return res.status(400).json({
      error: 'AI adapter not configured. Set at least one provider API key (WHATSAPP_LISTINGS_CLAUDE_API_KEY / OPENAI / GEMINI / etc.) and enable listings-ai.',
    })
  }
  try {
    const bundle = await regenerateLeadSummary({
      contactId: req.params.id,
      requesterAgentId: req.user.id,
      aiAdapter,
      provider: listingsAiModule.config?.aiProvider,
      logger,
    })
    if (bundle.error) {
      const code = bundle.error === 'Contact not found' ? 404 : 403
      return res.status(code).json({ error: bundle.error })
    }
    await logActivity({
      type: 'contact_lead_summary_regenerated',
      agent_id: req.user.id,
      meta: { contact_id: req.params.id, score: bundle.score?.score, steps_count: bundle.summary?.next_steps?.length || 0 },
    })
    res.json(bundle)
  } catch (err) {
    logger.error({ err: err.message, contact_id: req.params.id }, 'Lead summary regeneration failed')
    res.status(502).json({ error: err.message })
  }
})

app.post('/api/closed-transactions/import', authMiddleware, async (req, res) => {
  const { csv_text: csvText } = req.body || {}
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ error: 'csv_text (string) is required' })
  }
  if (csvText.length > 500_000) {
    return res.status(400).json({ error: 'CSV too large (500KB max)' })
  }
  try {
    const agent = await findOne('agents', (a) => a.id === req.user.id)
    const agencyId = agent?.agency_id || null
    const result = await importClosedTransactionsCsv({
      csvText,
      agentId: req.user.id,
      agencyId,
    })
    await logActivity({
      type: 'closed_transactions_csv_imported',
      agent_id: req.user.id,
      meta: { imported: result.imported, skipped: result.skipped },
    })
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ==================== CONTACT TIMELINE & NOTES ====================
app.get('/api/contacts/:id/timeline', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  res.json(await buildContactTimeline(contact.id))
})

app.get('/api/contacts/:id/notes', authMiddleware, async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const notes = (await findAll('contact_notes', (n) => n.contact_id === contact.id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  res.json(notes)
})

app.post('/api/contacts/:id/notes', authMiddleware, validate(contactNoteSchema), async (req, res) => {
  const contact = await findOne('contacts', (c) => c.id === req.params.id && c.assigned_agent_id === req.user.id)
  if (!contact) return res.status(404).json({ error: 'Contact not found' })
  const note = {
    id: uuidv4(),
    contact_id: contact.id,
    agent_id: req.user.id,
    author_name: req.user.name || 'Agent',
    content: req.validated.content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await insert('contact_notes', note)
  await logActivity({
    type: 'contact_note_added',
    agent_id: req.user.id,
    meta: { contact_id: contact.id, note_id: note.id },
  })
  res.json(note)
})

app.get('/api/automation/consumer/metrics', authMiddleware, async (req, res) => {
  const recentHistory = consumerAutomationState.run_history || []
  const userCheckpoints = await findAll('consumer_automation_checkpoints')
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const runsLastHour = recentHistory.filter((r) => r.ran_at >= oneHourAgo)

  res.json({
    status: consumerAutomationState.running ? 'running' : 'idle',
    last_run_at: consumerAutomationState.last_run_at,
    last_error: consumerAutomationState.last_error,
    config: {
      enabled: CONSUMER_AUTOMATION_ENABLED,
      interval_ms: CONSUMER_AUTOMATION_INTERVAL_MS,
      viewing_reminder_lead_minutes: VIEWING_REMINDER_LEAD_MINUTES,
      viewing_no_show_grace_minutes: VIEWING_NO_SHOW_GRACE_MINUTES,
    },
    aggregates: consumerAutomationState.metrics,
    recent_runs: recentHistory.slice(0, 20),
    runs_last_hour: {
      count: runsLastHour.length,
      users_processed: runsLastHour.reduce((s, r) => s + (r.summary?.users_processed || 0), 0),
      total_actions: runsLastHour.reduce((s, r) =>
        s
        + (r.summary?.searches_processed || 0)
        + (r.summary?.inquiry_overdue_marked || 0)
        + (r.summary?.reminders_sent || 0)
        + (r.summary?.no_shows_marked || 0), 0),
    },
    checkpoints: {
      total_users: userCheckpoints.length,
      oldest_checkpoint_at: userCheckpoints.length
        ? userCheckpoints
            .map((c) => c.last_run_at)
            .filter(Boolean)
            .sort()[0]
        : null,
    },
  })
})

app.post('/api/automation/consumer/run', authMiddleware, async (req, res) => {
  const scope = req.body?.scope === 'all' ? 'all' : 'self'
  const forceAlerts = req.body?.force_alerts === true
  if (scope === 'all' && !await isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'Only platform admins can run scope=all' })
  }
  const summary = await processConsumerJourneyAutomation({
    agentId: scope === 'all' ? null : req.user.id,
    forceAlerts,
    source: scope === 'all' ? 'manual_automation_run_all' : 'manual_automation_run_self',
    requestedBy: req.user.id,
  })
  res.json({ ran_at: new Date().toISOString(), scope, force_alerts: forceAlerts, summary })
})

app.delete('/api/saved-searches/:id', authMiddleware, async (req, res) => {
  await remove('saved_searches', s => s.id === req.params.id && s.user_id === req.user.id)
  res.json({ success: true })
})

async function logActivity(entry) {
  await insert('activity_log', { id: uuidv4(), created_at: new Date().toISOString(), ...entry })
}

const PLATFORM_CAPABILITIES = {
  whatsapp: {
    catalogue_sync: true, posting: true, draft_creation: true, direct_publishing: true,
    messaging: true, analytics: true, paid_promotion: false, payments: false,
  },
  telegram: {
    catalogue_sync: false, posting: true, draft_creation: true, direct_publishing: true,
    messaging: true, analytics: true, paid_promotion: false, payments: false,
  },
  instagram: {
    catalogue_sync: false, posting: true, draft_creation: true, direct_publishing: false,
    messaging: true, analytics: true, paid_promotion: true, payments: false,
  },
  tiktok: {
    catalogue_sync: false, posting: true, draft_creation: true, direct_publishing: false,
    messaging: false, analytics: true, paid_promotion: true, payments: false,
  },
  x: {
    catalogue_sync: false, posting: true, draft_creation: true, direct_publishing: true,
    messaging: true, analytics: true, paid_promotion: true, payments: false,
  },
  facebook: {
    catalogue_sync: false, posting: true, draft_creation: true, direct_publishing: true,
    messaging: true, analytics: true, paid_promotion: true, payments: false,
  },
  linkedin: {
    catalogue_sync: false, posting: true, draft_creation: true, direct_publishing: true,
    messaging: false, analytics: true, paid_promotion: true, payments: false,
  },
}

async function retryDistributionDelivery(row, { requestedBy, source = 'manual' } = {}) {
  const nowIso = new Date().toISOString()
  const previousMeta = row.meta || {}
  const retryAttempts = Number(previousMeta.retry_attempts || 0) + 1
  const property = await findOne('properties', p => p.id === row.property_id)
  const serialized = property ? serializeProperty(property) : null
  const conn = row.connection_id ? await findOne('marketplace_connections', c => c.id === row.connection_id) : null

  let status = row.status
  let externalId = row.external_id || null
  let error = null
  let publishedAt = row.published_at || null
  const meta = {
    ...previousMeta,
    retry_attempts: retryAttempts,
    last_retry_at: nowIso,
    retry_source: source,
    queued: false,
  }

  try {
    if (!serialized) {
      throw new Error('Property no longer exists for this distribution')
    }

    if (row.platform === 'whatsapp') {
      if (!isWhatsAppConfigured()) {
        throw new Error('WhatsApp Cloud API credentials are not configured on the server')
      }
      const recipient = meta.recipient || conn?.settings?.notify_number || getWhatsAppConfig().defaultRecipient
      if (!recipient) {
        throw new Error('Add a WhatsApp recipient number in Channel Settings (or WHATSAPP_DEFAULT_RECIPIENT in .env)')
      }
      const sent = await sendListingToWhatsApp(serialized, recipient)
      externalId = sent.message_id
      status = 'published'
      publishedAt = nowIso
      Object.assign(meta, {
        delivery: 'cloud_api',
        recipient: sent.recipient,
        message_id: sent.message_id,
        published_via: 'retry_worker',
        next_retry_at: null,
      })
      delete meta.details
    } else if (row.platform === 'instagram') {
      const imageUrls = meta.media_urls?.length ? meta.media_urls : (serialized.photos || [])
      const caption = meta.caption || `${serialized.title} · ${serialized.city || serialized.location || ''}`
      const formats = row.formats || meta.formats || []
      let publishResult
      if (formats.includes('carousel') && imageUrls.length > 1) {
        publishResult = await publishInstagramCarousel({ imageUrls, caption })
      } else if (formats.includes('reel') && imageUrls[0]?.includes('video')) {
        publishResult = await publishInstagramReel({ videoUrl: imageUrls[0], caption })
      } else if (formats.includes('story') && imageUrls.length) {
        publishResult = await publishInstagramStory({ imageUrl: imageUrls[0] })
      } else if (imageUrls.length) {
        publishResult = await publishInstagramFeed({ imageUrl: imageUrls[0], caption })
      } else {
        throw new Error('No media URLs available for Instagram publish')
      }
      externalId = publishResult.provider_message_id
      status = 'published'
      publishedAt = nowIso
      Object.assign(meta, {
        delivery: publishResult.simulated ? 'instagram_dev_simulator' : 'instagram_graph_api',
        published_via: 'retry_worker',
        provider: publishResult.provider,
        simulated: publishResult.simulated || false,
        next_retry_at: null,
      })
    } else {
      // Social retry currently confirms internal publish state and records external placeholder id.
      externalId = `retry_${row.platform}_${Date.now()}`
      status = 'published'
      publishedAt = nowIso
      Object.assign(meta, {
        delivery: 'agent_social_retry_queue',
        published_via: 'retry_worker_simulated',
        next_retry_at: null,
      })
    }
  } catch (e) {
    status = row.platform === 'whatsapp' ? 'failed' : 'pending_retry'
    error = e.message
    const exhausted = retryAttempts >= RETRY_MAX_ATTEMPTS
    const nextRetryAt = exhausted || row.platform === 'whatsapp'
      ? null
      : new Date(Date.now() + RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, retryAttempts - 1))).toISOString()
    Object.assign(meta, {
      queued: row.platform !== 'whatsapp' && !exhausted,
      exhausted,
      next_retry_at: nextRetryAt,
      details: e.details || null,
    })
    if (exhausted && row.platform !== 'whatsapp') {
      status = 'failed'
      error = `${e.message} (max retry attempts reached)`
    }
  }

  await update('distributions', d => d.id === row.id, d => ({
    ...d,
    status,
    error,
    external_id: externalId,
    published_at: publishedAt,
    meta,
  }))

  const updated = await findOne('distributions', d => d.id === row.id)
  await logActivity({
    type: status === 'published' ? 'distribution_retry_published' : 'distribution_retry_failed',
    property_id: row.property_id,
    agent_id: row.agent_id,
    meta: {
      platform: row.platform,
      distribution_id: row.id,
      status,
      error,
      requested_by: requestedBy,
      source,
      retry_attempts: retryAttempts,
    },
  })

  return updated
}

function isRetryDue(row, nowMs = Date.now()) {
  if (!row || row.status !== 'pending_retry' || row.owner_type !== 'agent') return false
  const attempts = Number(row?.meta?.retry_attempts || 0)
  if (attempts >= RETRY_MAX_ATTEMPTS) return false
  const nextRetryAt = row?.meta?.next_retry_at
  if (!nextRetryAt) return true
  return new Date(nextRetryAt).getTime() <= nowMs
}

async function processPendingDistributionRetries({
  limit = RETRY_WORKER_BATCH_SIZE,
  onlyDue = true,
  source = 'worker_scheduler',
  requestedBy = 'system',
  agentId,
} = {}) {
  const cappedLimit = Math.max(1, Math.min(limit, 200))
  const nowMs = Date.now()

  const rows = (await findAll('distributions', (d) => {
    if (d.owner_type !== 'agent') return false
    if (d.status !== 'pending_retry') return false
    if (agentId && d.agent_id !== agentId) return false
    return true
  }))
    .filter((d) => (onlyDue ? isRetryDue(d, nowMs) : true))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, cappedLimit)

  const results = []
  for (const row of rows) {
    const updated = await retryDistributionDelivery(row, { requestedBy, source })
    results.push(updated)
  }

  return {
    processed: results.length,
    published: results.filter((r) => r.status === 'published').length,
    failed: results.filter((r) => r.status === 'failed').length,
    requeued: results.filter((r) => r.status === 'pending_retry').length,
    results,
  }
}

// ==================== DISTRIBUTION HUB ====================
app.get('/api/platforms', (req, res) => {
  res.json([
    {
      id: 'whatsapp', name: 'WhatsApp Business', type: 'messaging', icon: 'whatsapp', requiresAuth: true,
      description: 'Send listing chat cards via WhatsApp Cloud API',
      formats: ['catalogue_item', 'chat_card', 'status_slides'],
      capabilities: PLATFORM_CAPABILITIES.whatsapp,
      limitations: isWhatsAppConfigured()
        ? 'Messages to new numbers may require an approved template outside the 24h window.'
        : 'Add META_ACCESS_TOKEN and WhatsApp IDs in .env to enable live sending.',
      configured: isWhatsAppConfigured(),
    },
    {
      id: 'telegram', name: 'Telegram', type: 'messaging', icon: 'telegram', requiresAuth: true,
      description: 'Channel posts, media albums, and bot deep links',
      formats: ['channel_post', 'media_album', 'bot_card'],
      capabilities: PLATFORM_CAPABILITIES.telegram,
      limitations: 'Bot and Mini App features require a connected bot token.',
    },
    {
      id: 'instagram', name: 'Instagram', type: 'social', icon: 'instagram', requiresAuth: true,
      description: 'Feed, carousel, Reel, and Story drafts',
      formats: ['feed_image', 'carousel', 'reel', 'story'],
      capabilities: PLATFORM_CAPABILITIES.instagram,
      limitations: 'Direct public publish may require Meta approval; drafts always available.',
    },
    {
      id: 'tiktok', name: 'TikTok', type: 'social', icon: 'tiktok', requiresAuth: true,
      description: 'Photo posts and vertical property tours',
      formats: ['photo_post', 'vertical_video', 'property_tour'],
      capabilities: PLATFORM_CAPABILITIES.tiktok,
      limitations: 'Draft fallback used when direct publishing is not permitted.',
    },
    {
      id: 'x', name: 'X (Twitter)', type: 'social', icon: 'x', requiresAuth: true,
      description: 'Image/video posts and listing threads',
      formats: ['image_post', 'video_post', 'thread'],
      capabilities: PLATFORM_CAPABILITIES.x,
      limitations: 'Thread generation available; paid promotion is optional.',
    },
    {
      id: 'facebook', name: 'Facebook', type: 'social', icon: 'facebook', requiresAuth: true,
      description: 'Page feed posts, photo posts, and Messenger replies',
      formats: ['feed_post', 'photo_post', 'video_post', 'messenger'],
      capabilities: PLATFORM_CAPABILITIES.facebook,
      limitations: isFacebookEnabled()
        ? 'Live posting active. Uses the page token in FACEBOOK_PAGE_ACCESS_TOKEN.'
        : 'Add FACEBOOK_PAGE_ACCESS_TOKEN + FACEBOOK_PAGE_ID in .env to enable live posting.',
      configured: isFacebookEnabled(),
    },
    {
      id: 'linkedin', name: 'LinkedIn', type: 'social', icon: 'linkedin', requiresAuth: true,
      description: 'Company page + personal UGC posts',
      formats: ['text_post', 'image_post', 'article_share'],
      capabilities: PLATFORM_CAPABILITIES.linkedin,
      limitations: isLinkedInEnabled()
        ? 'Live posting active. Image posts require a pre-uploaded asset URN.'
        : 'Add LINKEDIN_ACCESS_TOKEN + LINKEDIN_AUTHOR_URN in .env to enable live posting.',
      configured: isLinkedInEnabled(),
    },
  ])
})

app.get('/api/fi-accounts', async (req, res) => {
  res.json(await findAll('platform_accounts', a => a.type === 'fi'))
})

/* ============================================================================
 * Social Channels — multi-tenant credentials
 *
 * Enterprise-model platforms (Facebook, Instagram, LinkedIn, WhatsApp):
 *   Wingcaster holds the enterprise access token in env vars. Each tenant
 *   provides their platform target IDs (fb_page_id, ig_business_account_id,
 *   li_author_urn, wa_phone_number_id) so posts appear under the tenant's
 *   identity. Optional per-tenant token overrides are supported (encrypted).
 *
 * OAuth-model platforms (X, TikTok):
 *   Each tenant completes an OAuth flow. Their access token + refresh token
 *   are stored encrypted on the connection row.
 * ========================================================================== */

app.get('/api/social-channels/config', authMiddleware, (_req, res) => {
  res.json({
    integration_models: PLATFORM_INTEGRATION_MODEL,
    connection_fields: PLATFORM_CONNECTION_FIELDS,
  })
})

app.get('/api/social-channels', authMiddleware, async (req, res) => {
  const rows = await findAll('marketplace_connections', c => c.agent_id === req.user.id)
  res.json(rows.map(sanitizeSocialConnection))
})

app.put('/api/social-channels/:platform', authMiddleware, async (req, res) => {
  const platform = req.params.platform
  if (!PLATFORM_INTEGRATION_MODEL[platform]) {
    return res.status(400).json({ error: `Unsupported platform: ${platform}` })
  }
  const model = PLATFORM_INTEGRATION_MODEL[platform]
  const spec = PLATFORM_CONNECTION_FIELDS[platform]

  const enterpriseTargets = normalizeEnterpriseTargets(platform, req.body?.enterprise_targets || {})

  // Validate required target fields for enterprise model.
  if (model === 'enterprise') {
    for (const field of spec.target_fields) {
      if (field.required && !field.secret) {
        const val = enterpriseTargets[field.key]
        if (!val || String(val).trim() === '') {
          return res.status(400).json({ error: `${field.label} is required for ${platform}` })
        }
      }
    }
  }

  const existing = await findOne(
    'marketplace_connections',
    c => c.agent_id === req.user.id && c.platform === platform,
  )
  const accountName = req.body?.account_name || existing?.account_name || `${platform} account`

  const settingsPatch = {
    handle: req.body?.handle || existing?.settings?.handle || accountName,
    enterprise_targets: {
      ...(existing?.settings?.enterprise_targets || {}),
      ...enterpriseTargets,
    },
    credentials: existing?.settings?.credentials || {},
  }

  if (existing) {
    await update('marketplace_connections', c => c.id === existing.id, c => ({
      ...c,
      account_name: accountName,
      status: 'connected',
      health: 'healthy',
      capabilities: PLATFORM_CAPABILITIES[platform] || {},
      settings: {
        ...(c.settings || {}),
        ...settingsPatch,
      },
      updated_at: new Date().toISOString(),
    }))
    const updated = await findOne('marketplace_connections', c => c.id === existing.id)
    await logActivity({ type: 'social_connection_updated', agent_id: req.user.id, meta: { platform, connection_id: existing.id } })
    return res.json(sanitizeSocialConnection(updated))
  }

  const created = {
    id: uuidv4(),
    agent_id: req.user.id,
    platform,
    account_name: accountName,
    status: 'connected',
    health: 'healthy',
    capabilities: PLATFORM_CAPABILITIES[platform] || {},
    settings: settingsPatch,
    terms_accepted_at: new Date().toISOString(),
    terms_version: '2026-07-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await insert('marketplace_connections', created)
  await logActivity({ type: 'social_connection_created', agent_id: req.user.id, meta: { platform, connection_id: created.id } })
  res.json(sanitizeSocialConnection(created))
})

app.delete('/api/social-channels/:platform', authMiddleware, async (req, res) => {
  const platform = req.params.platform
  const existing = await findOne(
    'marketplace_connections',
    c => c.agent_id === req.user.id && c.platform === platform,
  )
  if (!existing) return res.status(404).json({ error: 'Not connected' })
  await update('marketplace_connections', c => c.id === existing.id, c => ({
    ...c,
    status: 'disconnected',
    settings: {
      ...(c.settings || {}),
      credentials: {},
    },
    updated_at: new Date().toISOString(),
  }))
  await logActivity({ type: 'social_connection_disconnected', agent_id: req.user.id, meta: { platform, connection_id: existing.id } })
  res.json({ ok: true })
})

/* --- OAuth start/callback (per-agent — X, TikTok) --- */

function getOAuthConfig(platform) {
  if (platform === 'x') {
    return {
      auth_url: 'https://twitter.com/i/oauth2/authorize',
      token_url: 'https://api.twitter.com/2/oauth2/token',
      scope: 'tweet.read tweet.write users.read offline.access',
      client_id: process.env.X_OAUTH_CLIENT_ID || '',
      client_secret: process.env.X_OAUTH_CLIENT_SECRET || '',
      dev: process.env.X_PROVIDER !== 'x_api_v2' || !process.env.X_OAUTH_CLIENT_ID,
    }
  }
  if (platform === 'tiktok') {
    return {
      auth_url: 'https://www.tiktok.com/v2/auth/authorize/',
      token_url: 'https://open.tiktokapis.com/v2/oauth/token/',
      scope: 'user.info.basic,video.publish',
      client_id: process.env.TIKTOK_CLIENT_KEY || '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
      dev: process.env.TIKTOK_PROVIDER !== 'tiktok_for_business' || !process.env.TIKTOK_CLIENT_KEY,
    }
  }
  return null
}

function getOAuthRedirectBase(req) {
  return process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}/api`
}

app.get('/api/social-channels/oauth/:platform/start', authMiddleware, async (req, res) => {
  const platform = req.params.platform
  if (PLATFORM_INTEGRATION_MODEL[platform] !== 'oauth') {
    return res.status(400).json({ error: `${platform} is not an OAuth platform` })
  }
  const cfg = getOAuthConfig(platform)
  if (!cfg) return res.status(400).json({ error: 'Unsupported platform' })

  const state = uuidv4()
  const redirectUri = `${getOAuthRedirectBase(req)}/social-channels/oauth/${platform}/callback`

  // Persist state → agent binding so we can validate on callback.
  await insert('oauth_states', {
    id: state,
    agent_id: req.user.id,
    platform,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })

  if (cfg.dev) {
    // Dev mode: skip the platform entirely, redirect straight to our callback
    // with a synthetic code so the flow completes end-to-end without live creds.
    const devUrl = `${redirectUri}?code=dev_ok&state=${state}`
    return res.json({ auth_url: devUrl, state, dev: true })
  }

  const authUrl = new URL(cfg.auth_url)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', cfg.client_id)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', cfg.scope)
  authUrl.searchParams.set('state', state)
  if (platform === 'x') {
    // PKCE — we use plain challenge in dev; production must generate a real one.
    authUrl.searchParams.set('code_challenge', state)
    authUrl.searchParams.set('code_challenge_method', 'plain')
  }
  if (platform === 'tiktok') {
    authUrl.searchParams.set('client_key', cfg.client_id)
  }

  res.json({ auth_url: authUrl.toString(), state, dev: false })
})

app.get('/api/social-channels/oauth/:platform/callback', async (req, res) => {
  const platform = req.params.platform
  if (PLATFORM_INTEGRATION_MODEL[platform] !== 'oauth') {
    return res.status(400).send('Unsupported platform')
  }
  const { code, state, error } = req.query
  if (error) return res.status(400).send(`OAuth error: ${error}`)
  if (!code || !state) return res.status(400).send('Missing code or state')

  const stateRow = await findOne('oauth_states', s => s.id === state)
  if (!stateRow || stateRow.platform !== platform) {
    return res.status(400).send('Invalid or expired state')
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    return res.status(400).send('State expired — restart the connect flow')
  }

  const cfg = getOAuthConfig(platform)
  let tokenPayload = null
  let userInfo = null

  if (cfg.dev || code === 'dev_ok') {
    // Dev-mode: synthesize a token so downstream publish adapters work.
    tokenPayload = {
      access_token: `dev_${platform}_${uuidv4().slice(0, 20)}`,
      refresh_token: `dev_refresh_${platform}_${uuidv4().slice(0, 20)}`,
      expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    }
    userInfo = { id: `dev_${platform}_user`, handle: `dev_${platform}_handle` }
  } else {
    try {
      const redirectUri = `${getOAuthRedirectBase(req)}/social-channels/oauth/${platform}/callback`
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
        client_id: cfg.client_id,
      })
      if (platform === 'x') body.set('code_verifier', String(state))
      if (platform === 'tiktok') {
        body.set('client_key', cfg.client_id)
        body.set('client_secret', cfg.client_secret)
      }
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
      if (platform === 'x' && cfg.client_secret) {
        const basic = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64')
        headers.Authorization = `Basic ${basic}`
      }
      const tokenRes = await fetch(cfg.token_url, { method: 'POST', headers, body })
      const parsed = await tokenRes.json().catch(() => ({}))
      if (!tokenRes.ok) {
        return res.status(502).send(`Token exchange failed: ${parsed?.error || tokenRes.status}`)
      }
      tokenPayload = {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token || null,
        expires_at: parsed.expires_in
          ? new Date(Date.now() + Number(parsed.expires_in) * 1000).toISOString()
          : null,
        scope: parsed.scope || cfg.scope,
      }
      userInfo = { id: parsed.open_id || parsed.user_id || null, handle: null }
    } catch (e) {
      logger.error({ err: e.message, platform }, 'OAuth token exchange failed')
      return res.status(502).send('OAuth token exchange failed')
    }
  }

  // Persist encrypted tokens on the tenant's connection row.
  const existing = await findOne(
    'marketplace_connections',
    c => c.agent_id === stateRow.agent_id && c.platform === platform,
  )
  const credentialsPatch = {
    access_token_encrypted: encryptSecret(tokenPayload.access_token),
    refresh_token_encrypted: tokenPayload.refresh_token ? encryptSecret(tokenPayload.refresh_token) : null,
    expires_at: tokenPayload.expires_at || null,
    scope: tokenPayload.scope || cfg.scope,
    user_id: userInfo?.id || null,
  }

  if (existing) {
    await update('marketplace_connections', c => c.id === existing.id, c => ({
      ...c,
      status: 'connected',
      health: 'healthy',
      capabilities: PLATFORM_CAPABILITIES[platform] || {},
      settings: {
        ...(c.settings || {}),
        credentials: credentialsPatch,
        handle: userInfo?.handle || c.settings?.handle || `${platform} account`,
      },
      updated_at: new Date().toISOString(),
    }))
  } else {
    await insert('marketplace_connections', {
      id: uuidv4(),
      agent_id: stateRow.agent_id,
      platform,
      account_name: userInfo?.handle || `${platform} account`,
      status: 'connected',
      health: 'healthy',
      capabilities: PLATFORM_CAPABILITIES[platform] || {},
      settings: {
        handle: userInfo?.handle || `${platform} account`,
        enterprise_targets: {},
        credentials: credentialsPatch,
      },
      terms_accepted_at: new Date().toISOString(),
      terms_version: '2026-07-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  await remove('oauth_states', s => s.id === state)
  await logActivity({
    type: 'social_oauth_completed',
    agent_id: stateRow.agent_id,
    meta: { platform, dev: cfg.dev },
  })

  // Return a small HTML page that closes the popup window and signals success.
  res.send(`<!doctype html><html><body style="font-family:system-ui;padding:2rem;text-align:center;">
<h2>Connected to ${platform}</h2>
<p>You can close this window and return to Wingcaster.</p>
<script>try { window.opener && window.opener.postMessage({ type: 'wingcaster:oauth:done', platform: '${platform}' }, '*'); } catch(e){}
setTimeout(() => { window.close() }, 800)</script>
</body></html>`)
})

function normalizeEnterpriseTargets(platform, input) {
  const spec = PLATFORM_CONNECTION_FIELDS[platform]
  if (!spec) return {}
  const out = {}
  for (const field of spec.target_fields || []) {
    const raw = input[field.key]
    if (raw == null || raw === '') continue
    if (field.secret) {
      // Store as `<key>_encrypted`, keep the plain key absent so we never leak it.
      out[`${field.key}_encrypted`] = encryptSecret(String(raw))
    } else {
      out[field.key] = String(raw).trim()
    }
  }
  return out
}

function sanitizeSocialConnection(row) {
  if (!row) return null
  const settings = row.settings || {}
  const targets = { ...(settings.enterprise_targets || {}) }
  // Redact anything encrypted before returning to the client — we never send
  // ciphertext to the browser.
  for (const key of Object.keys(targets)) {
    if (key.endsWith('_encrypted')) {
      targets[key.replace(/_encrypted$/, '')] = '••••••••'
      delete targets[key]
    }
  }
  const creds = settings.credentials || {}
  const hasOAuth = Boolean(creds.access_token_encrypted)
  return {
    id: row.id,
    platform: row.platform,
    account_name: row.account_name,
    status: row.status,
    health: row.health,
    handle: settings.handle || null,
    enterprise_targets: targets,
    oauth: hasOAuth ? {
      connected: true,
      scope: creds.scope || null,
      expires_at: creds.expires_at || null,
      user_id: creds.user_id || null,
    } : { connected: false },
    updated_at: row.updated_at || row.created_at || null,
  }
}

app.get('/api/my-connections', authMiddleware, async (req, res) => {
  res.json(await findAll('marketplace_connections', c => c.agent_id === req.user.id))
})

app.post('/api/my-connections', authMiddleware, async (req, res) => {
  const platform = req.body.platform
  const allowed = ['whatsapp', 'instagram', 'telegram', 'tiktok', 'x', 'facebook', 'linkedin']
  if (!allowed.includes(platform)) {
    return res.status(400).json({ error: 'Unsupported platform. Use Instagram, Facebook, LinkedIn, Telegram, TikTok, X, or WhatsApp.' })
  }
  let health = 'healthy'
  let healthError = null
  let accountName = req.body.account_name
  const handle = String(req.body.handle || req.body.settings?.handle || accountName || '').trim()

  if (platform === 'whatsapp') {
    if (!isWhatsAppConfigured()) {
      return res.status(400).json({ error: 'WhatsApp is not configured on the server (.env credentials missing)' })
    }
    const status = await getWhatsAppHealth()
    if (!status.healthy) {
      return res.status(400).json({ error: status.error || 'WhatsApp health check failed', details: status.details })
    }
    health = 'healthy'
    accountName = accountName || status.display_phone_number || status.verified_name || 'WhatsApp Business'
  } else if (!handle) {
    return res.status(400).json({ error: 'Account handle / username is required' })
  } else {
    accountName = accountName || handle
  }

  const existing = await findOne('marketplace_connections', c => c.agent_id === req.user.id && c.platform === platform)
  if (existing) {
    await update('marketplace_connections', c => c.id === existing.id, c => ({
      ...c,
      account_name: accountName || c.account_name,
      status: 'connected',
      health,
      health_error: healthError,
      capabilities: PLATFORM_CAPABILITIES[platform] || {},
      settings: {
        ...(c.settings || {}),
        ...(req.body.settings || {}),
        handle: handle || c.settings?.handle || accountName,
        channel_id: req.body.channel_id || req.body.settings?.channel_id || c.settings?.channel_id || '',
      },
      terms_accepted_at: new Date().toISOString(),
      terms_version: '2026-07-1',
      updated_at: new Date().toISOString(),
    }))
    const updated = await findOne('marketplace_connections', c => c.id === existing.id)
    await logActivity({ type: 'connection_updated', agent_id: req.user.id, meta: { platform, connection_id: existing.id } })
    return res.json(updated)
  }
  const conn = {
    id: uuidv4(),
    agent_id: req.user.id,
    platform,
    account_name: accountName,
    status: 'connected',
    health,
    health_error: healthError,
    capabilities: PLATFORM_CAPABILITIES[platform] || {},
    settings: {
      enabled: true,
      auto_publish: false,
      approval_required: false,
      language: 'en',
      notify_number: req.body.settings?.notify_number || '',
      handle: handle || accountName,
      channel_id: req.body.channel_id || req.body.settings?.channel_id || '',
      ...(req.body.settings || {}),
    },
    terms_accepted_at: new Date().toISOString(),
    terms_version: '2026-07-1',
    created_at: new Date().toISOString(),
  }
  await insert('marketplace_connections', conn)
  await logActivity({ type: 'connection_created', agent_id: req.user.id, meta: { platform, connection_id: conn.id } })
  res.json(conn)
})

app.put('/api/my-connections/:id', authMiddleware, async (req, res) => {
  await update('marketplace_connections', c => c.id === req.params.id && c.agent_id === req.user.id, c => ({
    ...c,
    ...req.body,
    settings: req.body.settings ? { ...(c.settings || {}), ...req.body.settings } : c.settings,
    updated_at: new Date().toISOString(),
  }))
  await logActivity({ type: 'connection_updated', agent_id: req.user.id, meta: { connection_id: req.params.id } })
  res.json({ success: true })
})

app.delete('/api/my-connections/:id', authMiddleware, async (req, res) => {
  await remove('marketplace_connections', c => c.id === req.params.id && c.agent_id === req.user.id)
  await logActivity({ type: 'connection_disconnected', agent_id: req.user.id, meta: { connection_id: req.params.id } })
  res.json({ success: true })
})

app.post('/api/properties/:propertyId/distribute-own', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  if (prop.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  const { platforms, formats, mode, recipient, caption, intent } = req.body
  if (!platforms?.length) return res.status(400).json({ error: 'Select at least one platform' })

  const serialized = serializeProperty(prop)
  const distributions = []
  const fatalWhatsAppFailures = []
  const autoCaption = caption || `${serialized.title} · ${serialized.city || serialized.location || ''} · $${Number(serialized.price || 0).toLocaleString()}\n\nAvailable on REB`

  for (const platform of platforms) {
    const conn = await findOne('marketplace_connections', c => c.agent_id === req.user.id && c.platform === platform && c.status === 'connected')
    if (!conn) {
      const failed = {
        id: uuidv4(),
        property_id: req.params.propertyId,
        agent_id: req.user.id,
        platform,
        owner_type: 'agent',
        status: 'failed',
        error: 'Platform not connected. Connect it under Channel Settings first.',
        formats: formats?.[platform] || [],
        created_at: new Date().toISOString(),
      }
      await insert('distributions', failed)
      distributions.push(failed)
      if (platform === 'whatsapp') {
        fatalWhatsAppFailures.push({ platform, error: failed.error })
      }
      continue
    }

    const approvalRequired = conn.settings?.approval_required && mode !== 'publish'
    let status = approvalRequired || mode === 'draft' ? 'draft' : 'published'
    let externalId = null
    let error = null
    let meta = {}

    if (platform === 'whatsapp') {
      const card = buildListingChatCard(serialized)
      meta = { format: 'chat_card', preview: card.body, listing_url: card.listingUrl, intent: intent || 'distribute' }

      if (status === 'draft') {
        meta.delivery = 'draft_only'
      } else if (!isWhatsAppConfigured()) {
        status = 'failed'
        error = 'WhatsApp Cloud API credentials are not configured on the server'
      } else {
        const to = recipient || conn.settings?.notify_number || getWhatsAppConfig().defaultRecipient
        if (!to) {
          status = 'failed'
          error = 'Add a WhatsApp recipient number in Channel Settings (or WHATSAPP_DEFAULT_RECIPIENT in .env)'
        } else {
          try {
            const sent = await sendListingToWhatsApp(serialized, to)
            externalId = sent.message_id
            meta = {
              ...meta,
              recipient: sent.recipient,
              message_id: sent.message_id,
              delivery: 'cloud_api',
            }
          } catch (e) {
            status = 'failed'
            error = e.message
            meta.details = e.details || null
          }
        }
      }
    } else {
      // Instagram / Telegram / TikTok / X — queue for retries (Decision C).
      // WhatsApp is the only hard-fail channel; social channels enter pending_retry queue.
      if (status !== 'draft') status = 'pending_retry'
      externalId = null
      const formatMap = {
        instagram: 'feed_image',
        telegram: 'channel_post',
        tiktok: 'photo_post',
        x: 'image_post',
      }
      meta = {
        delivery: 'agent_social_retry_queue',
        queued: status === 'pending_retry',
        retry_attempts: 0,
        next_retry_at: status === 'pending_retry' ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
        intent: intent || 'distribute',
        handle: conn.settings?.handle || conn.account_name,
        caption: autoCaption,
        format: formatMap[platform] || 'post',
        note: status === 'pending_retry'
          ? 'Queued for retry publishing. A publisher worker or manual retry can complete delivery.'
          : 'Saved as draft.',
      }
    }

    const row = {
      id: uuidv4(),
      property_id: req.params.propertyId,
      agent_id: req.user.id,
      platform,
      owner_type: 'agent',
      connection_id: conn.id,
      account_name: conn.account_name,
      status,
      error,
      formats: formats?.[platform] || (platform === 'whatsapp' ? ['chat_card'] : [meta.format].filter(Boolean)),
      external_id: externalId,
      meta,
      views: 0,
      leads: 0,
      clicks: 0,
      cost: 0,
      published_at: status === 'published' ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
    }
    await insert('distributions', row)
    await logActivity({
      type: status === 'published'
        ? 'distribution_published'
        : status === 'failed'
          ? 'distribution_failed'
          : status === 'pending_retry'
            ? 'distribution_queued_retry'
            : 'distribution_draft',
      property_id: row.property_id,
      agent_id: req.user.id,
      meta: { platform, distribution_id: row.id, status, error, external_id: externalId, intent: intent || 'distribute' },
    })
    distributions.push(row)

    if (platform === 'whatsapp' && status === 'failed') {
      fatalWhatsAppFailures.push({ platform, error: error || 'WhatsApp delivery failed' })
    }
  }

  if (fatalWhatsAppFailures.length > 0) {
    return res.status(400).json({
      error: 'WhatsApp delivery failed. Social channels were queued for retry where applicable.',
      fatal_channel: 'whatsapp',
      failures: fatalWhatsAppFailures,
      distributions,
    })
  }

  res.json(distributions)
})

/**
 * Direct-publish path: fans out to platform-specific publish scaffolds.
 * Unlike /distribute-own (which queues for retry on social channels), this
 * endpoint hits the real IG / FB / X / TikTok / LinkedIn publish functions
 * directly. Dev-mode adapters return simulated results so the UX works
 * end-to-end without live credentials.
 */
app.post('/api/listings/:id/publish-social', authMiddleware, async (req, res) => {
  const property = await findOne('properties', p => p.id === req.params.id)
  if (!property) return res.status(404).json({ error: 'Listing not found' })
  if (property.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  const { channels, caption } = req.body || {}
  if (!Array.isArray(channels) || channels.length === 0) {
    return res.status(400).json({ error: 'channels[] must have at least one entry' })
  }

  const mediaUrls = Array.isArray(req.body?.media_urls) && req.body.media_urls.length > 0
    ? req.body.media_urls
    : Array.isArray(property.photos) ? property.photos : []
  const firstImage = mediaUrls.find((u) => typeof u === 'string' && !/\.(mp4|webm|mov)(\?|$)/i.test(u)) || mediaUrls[0]
  const firstVideo = mediaUrls.find((u) => typeof u === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(u))
  const text = String(caption || '').trim() || `${property.title} — ${[property.city, property.neighborhood].filter(Boolean).join(', ')}`

  const results = []
  for (const raw of channels) {
    const platform = raw?.platform
    const format = raw?.format || null
    if (!platform) {
      results.push({ platform, status: 'failed', error: 'platform is required' })
      continue
    }

    const conn = await findOne(
      'marketplace_connections',
      c => c.agent_id === req.user.id && c.platform === platform && c.status === 'connected',
    )
    if (!conn) {
      results.push({
        platform,
        status: 'failed',
        error: `${platform} is not connected. Connect it in Settings → Integrations.`,
      })
      continue
    }

    // Resolve per-tenant creds. Enterprise platforms use Wingcaster's env
    // token + the tenant's target ID; OAuth platforms use the tenant's own
    // stored access token.
    const creds = resolveConnectionCredentials(conn)
    const model = PLATFORM_INTEGRATION_MODEL[platform] || 'enterprise'

    let publishResult = null
    let publishError = null
    try {
      switch (platform) {
        case 'instagram': {
          if (!creds.ig_business_account_id) {
            throw Object.assign(
              new Error('Instagram Business Account ID missing on this tenant\'s connection'),
              { code: 'MISSING_TENANT_TARGET' },
            )
          }
          const igArgs = {
            businessAccountId: creds.ig_business_account_id,
            accessToken: creds.ig_page_access_token_override || undefined,
          }
          if (format === 'reel' && firstVideo) {
            publishResult = await publishInstagramReel({ videoUrl: firstVideo, caption: text, ...igArgs })
          } else if (format === 'story' && firstImage) {
            publishResult = await publishInstagramStory({ imageUrl: firstImage, ...igArgs })
          } else if (mediaUrls.length > 1) {
            publishResult = await publishInstagramCarousel({ imageUrls: mediaUrls.slice(0, 10), caption: text, ...igArgs })
          } else if (firstImage) {
            publishResult = await publishInstagramFeed({ imageUrl: firstImage, caption: text, ...igArgs })
          } else {
            throw Object.assign(new Error('Instagram publish requires at least one image or video'), { code: 'MISSING_MEDIA' })
          }
          break
        }
        case 'facebook': {
          if (!creds.fb_page_id) {
            throw Object.assign(
              new Error('Facebook Page ID missing on this tenant\'s connection'),
              { code: 'MISSING_TENANT_TARGET' },
            )
          }
          const fbArgs = {
            pageId: creds.fb_page_id,
            accessToken: creds.fb_page_access_token_override || undefined,
          }
          if (firstImage) {
            publishResult = await publishFacebookPagePhoto({ imageUrl: firstImage, caption: text, ...fbArgs })
          } else {
            publishResult = await publishFacebookPagePost({ message: text, linkUrl: raw?.link_url || null, ...fbArgs })
          }
          break
        }
        case 'x': {
          // OAuth model — the tenant's own token must be stored on the connection.
          if (!creds.oauth_access_token) {
            throw Object.assign(
              new Error('X is not connected for this tenant. Complete OAuth in Settings → Channels.'),
              { code: 'MISSING_OAUTH_TOKEN' },
            )
          }
          publishResult = await publishXTweet({ text, bearerToken: creds.oauth_access_token })
          break
        }
        case 'tiktok': {
          if (!creds.oauth_access_token) {
            throw Object.assign(
              new Error('TikTok is not connected for this tenant. Complete OAuth in Settings → Channels.'),
              { code: 'MISSING_OAUTH_TOKEN' },
            )
          }
          const ttArgs = { accessToken: creds.oauth_access_token }
          if (firstVideo) {
            publishResult = await publishTikTokVideo({ videoUrl: firstVideo, caption: text, ...ttArgs })
          } else if (mediaUrls.length > 0) {
            publishResult = await publishTikTokPhoto({ imageUrls: mediaUrls.slice(0, 10), caption: text, ...ttArgs })
          } else {
            throw Object.assign(new Error('TikTok publish requires at least one photo or video'), { code: 'MISSING_MEDIA' })
          }
          break
        }
        case 'linkedin': {
          if (!creds.li_author_urn) {
            throw Object.assign(
              new Error('LinkedIn Author URN missing on this tenant\'s connection'),
              { code: 'MISSING_TENANT_TARGET' },
            )
          }
          publishResult = await publishLinkedInPost({
            commentary: text,
            authorUrn: creds.li_author_urn,
            accessToken: creds.li_access_token_override || undefined,
          })
          break
        }
        default:
          throw Object.assign(new Error(`Direct publish for ${platform} is not yet implemented`), {
            code: 'NOT_SUPPORTED',
          })
      }
    } catch (e) {
      publishError = e
    }
    // Silence unused-var warnings — `model` is exposed on the row for observability.
    void model

    const status = publishError ? 'failed' : 'published'
    const externalId =
      publishResult?.publish_id ||
      publishResult?.post_id ||
      publishResult?.tweet_id ||
      publishResult?.post_urn ||
      null
    const externalUrl = publishResult?.external_url || null
    const row = {
      id: uuidv4(),
      property_id: property.id,
      agent_id: req.user.id,
      platform,
      owner_type: 'agent',
      status,
      external_id: externalId,
      error: publishError?.message || null,
      formats: format ? [format] : [],
      connection_id: conn.id,
      meta: {
        format: format || null,
        caption: text,
        media_count: mediaUrls.length,
        external_url: externalUrl,
        simulated: publishResult?.simulated || false,
        provider: publishResult?.provider || null,
        intent: 'publish',
      },
      views: 0,
      leads: 0,
      clicks: 0,
      cost: 0,
      published_at: status === 'published' ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
    }
    await insert('distributions', row)
    await logActivity({
      type: status === 'published' ? 'distribution_published' : 'distribution_failed',
      property_id: property.id,
      agent_id: req.user.id,
      meta: {
        platform,
        distribution_id: row.id,
        status,
        external_id: externalId,
        provider: publishResult?.provider || null,
        error: publishError?.message || null,
      },
    })

    results.push({
      platform,
      status,
      external_id: externalId,
      external_url: externalUrl,
      provider: publishResult?.provider || null,
      simulated: publishResult?.simulated || false,
      error: publishError?.message || null,
    })
  }

  res.json({ results })
})

// ==================== WHATSAPP CLOUD API ====================
app.get('/api/whatsapp/status', authMiddleware, async (_req, res) => {
  const health = await getWhatsAppHealth()
  res.json({
    ...health,
    verify_token_configured: Boolean(getWhatsAppConfig().verifyToken),
    default_recipient_configured: Boolean(getWhatsAppConfig().defaultRecipient),
    webhook_path: '/api/webhooks/whatsapp',
  })
})

app.post('/api/whatsapp/send-listing', authMiddleware, async (req, res) => {
  try {
    if (!isWhatsAppConfigured()) return res.status(400).json({ error: 'WhatsApp is not configured' })
    const { property_id, to } = req.body
    const prop = await findOne('properties', p => p.id === property_id)
    if (!prop) return res.status(404).json({ error: 'Property not found' })
    if (prop.agent_id !== req.user.id && !await isPlatformAdmin(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const result = await sendListingToWhatsApp(serializeProperty(prop), to)
    await logActivity({
      type: 'whatsapp_listing_sent',
      property_id: prop.id,
      agent_id: req.user.id,
      meta: { recipient: result.recipient, message_id: result.message_id },
    })
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message, details: e.details || null, code: e.code || null })
  }
})

app.post('/api/whatsapp/send-text', authMiddleware, async (req, res) => {
  try {
    if (!isWhatsAppConfigured()) return res.status(400).json({ error: 'WhatsApp is not configured' })
    const { to, message } = req.body
    const result = await sendWhatsAppText(to, message)
    res.json({ message_id: result?.messages?.[0]?.id || null, response: result })
  } catch (e) {
    res.status(400).json({ error: e.message, details: e.details || null })
  }
})

app.get('/api/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  const verifyToken = getWhatsAppConfig().verifyToken
  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge)
  }
  return res.sendStatus(403)
})

app.post('/api/webhooks/whatsapp', async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'] || ''
    let moduleResult = null
    if (whatsAppListingsModule.enabled) {
      try {
        moduleResult = await whatsAppListingsModule.handleWebhook({
          rawBody: req.rawBody,
          signature,
          payload: req.body,
        })
      } catch (err) {
        logger.error({ error: err.message }, 'WhatsApp listing module webhook error')
      }
    }

    // Fallback to conversation orchestrator for messages the module did not handle.
    const events = parseIncomingWhatsAppWebhook(req.body)
    const results = moduleResult?.results || []
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const moduleHandled = moduleResult?.results?.[i]?.handled
      if (moduleHandled) continue

      if (event.type === 'message' && (event.text || event.media?.length)) {
        try {
          const result = await ingestInboundMessage({
            channel: 'whatsapp',
            provider: 'whatsapp_cloud_api',
            providerMessageId: event.message_id,
            from: event.from,
            to: null,
            content: event.text || '',
            contentType: event.media?.length ? 'media' : 'text',
            rawPayload: req.body,
            name: event.name,
          })
          results.push({ type: 'message', contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
          await logActivity({
            type: 'whatsapp_inbound_message',
            property_id: null,
            agent_id: result.contact?.assigned_agent_id,
            meta: {
              from: event.from,
              message_id: event.message_id,
              contact_id: result.contact?.id,
              conversation_id: result.conversation?.id,
            },
          })
        } catch (err) {
          logger.error({ error: err.message }, 'WhatsApp inbound orchestration error')
          results.push({ type: 'message', error: err.message })
        }
      } else if (event.type === 'status') {
        // Update conversation message status if it exists.
        const updated = await updateMessageStatus({
          provider: 'whatsapp_cloud_api',
          providerMessageId: event.message_id,
          status: event.status,
          timestamp: event.timestamp ? new Date(Number(event.timestamp) * 1000).toISOString() : new Date().toISOString(),
        })
        results.push({ type: 'status', message_id: event.message_id, status: event.status, updated: Boolean(updated) })
        // Keep existing distribution status update for backward compatibility.
        await update(
          'distributions',
          d => d.external_id === event.message_id,
          d => ({
            ...d,
            delivery_status: event.status,
            meta: { ...(d.meta || {}), last_status: event.status, status_at: event.timestamp },
          }),
        )
      }
    }
    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'WhatsApp webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

// ==================== SMS WEBHOOKS ====================
app.post('/api/webhooks/sms', async (req, res) => {
  try {
    const events = parseIncomingSMSWebhook(req.body)
    const statusEvents = parseSMSStatusWebhook(req.body)
    const allEvents = [...events, ...statusEvents]
    const results = []

    for (const event of allEvents) {
      if (event.type === 'message' && event.text) {
        try {
          const result = await ingestInboundMessage({
            channel: 'sms',
            provider: event.provider || 'twilio',
            providerMessageId: event.message_id,
            from: event.from,
            to: event.to,
            content: event.text,
            contentType: 'text',
            rawPayload: req.body,
          })
          results.push({ type: 'message', contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
          await logActivity({
            type: 'sms_inbound_message',
            agent_id: result.contact?.assigned_agent_id,
            meta: {
              from: event.from,
              message_id: event.message_id,
              contact_id: result.contact?.id,
              conversation_id: result.conversation?.id,
            },
          })
        } catch (err) {
          logger.error({ error: err.message }, 'SMS inbound orchestration error')
          results.push({ type: 'message', error: err.message })
        }
      } else if (event.type === 'status') {
        const updated = await updateMessageStatus({
          provider: event.provider,
          providerMessageId: event.message_id,
          status: event.status,
        })
        results.push({ type: 'status', message_id: event.message_id, status: event.status, updated: Boolean(updated) })
      }
    }

    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'SMS webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

// ==================== EMAIL WEBHOOKS ====================
app.post('/api/webhooks/email', async (req, res) => {
  try {
    const events = parseIncomingEmailWebhook(req.body)
    const statusEvents = parseEmailStatusWebhook(req.body)
    const allEvents = [...events, ...statusEvents]
    const results = []

    for (const event of allEvents) {
      if (event.type === 'message' && event.text) {
        try {
          const result = await ingestInboundMessage({
            channel: 'email',
            provider: event.provider || 'sendgrid',
            providerMessageId: event.message_id,
            from: event.from,
            to: event.to,
            content: event.text,
            contentType: 'text',
            rawPayload: { ...req.body, html: event.html, subject: event.subject },
            subject: event.subject,
          })
          results.push({ type: 'message', contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
          await logActivity({
            type: 'email_inbound_message',
            agent_id: result.contact?.assigned_agent_id,
            meta: {
              from: event.from,
              message_id: event.message_id,
              contact_id: result.contact?.id,
              conversation_id: result.conversation?.id,
            },
          })
        } catch (err) {
          logger.error({ error: err.message }, 'Email inbound orchestration error')
          results.push({ type: 'message', error: err.message })
        }
      } else if (event.type === 'status') {
        const updated = await updateMessageStatus({
          provider: event.provider,
          providerMessageId: event.message_id,
          status: event.status,
        })
        results.push({ type: 'status', message_id: event.message_id, status: event.status, updated: Boolean(updated) })
      }
    }

    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'Email webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

// ==================== INSTAGRAM WEBHOOKS ====================
app.get('/api/webhooks/instagram', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  const verifyToken = getWhatsAppConfig().verifyToken
  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge)
  }
  return res.sendStatus(403)
})

app.post('/api/webhooks/instagram', async (req, res) => {
  try {
    const dmEvents = parseIncomingInstagramDMWebhook(req.body)
    const commentEvents = parseIncomingInstagramCommentWebhook(req.body)
    const allEvents = [...dmEvents, ...commentEvents]
    const results = []

    for (const event of allEvents) {
      if (event.type === 'dm' && event.text) {
        try {
          const result = await ingestInboundMessage({
            channel: 'instagram_dm',
            provider: event.provider,
            providerMessageId: event.message_id,
            from: event.from,
            to: event.to || null,
            content: event.text,
            contentType: event.attachment_url ? 'image' : 'text',
            rawPayload: event,
            name: event.from_username,
          })
          results.push({ type: 'dm', contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
          await logActivity({
            type: 'instagram_dm_inbound_message',
            agent_id: result.contact?.assigned_agent_id,
            meta: {
              from: event.from,
              message_id: event.message_id,
              contact_id: result.contact?.id,
              conversation_id: result.conversation?.id,
            },
          })
        } catch (err) {
          logger.error({ error: err.message }, 'Instagram DM inbound orchestration error')
          results.push({ type: 'dm', error: err.message })
        }
      } else if (event.type === 'comment' && event.text) {
        try {
          const result = await ingestInboundMessage({
            channel: 'instagram_comment',
            provider: event.provider,
            providerMessageId: event.message_id,
            from: event.from,
            to: event.media_id || null,
            content: event.text,
            contentType: 'text',
            rawPayload: event,
            name: event.from_username,
            visibility: 'public',
          })
          results.push({ type: 'comment', contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
          await logActivity({
            type: 'instagram_comment_inbound_message',
            agent_id: result.contact?.assigned_agent_id,
            meta: {
              from: event.from,
              message_id: event.message_id,
              media_id: event.media_id,
              contact_id: result.contact?.id,
              conversation_id: result.conversation?.id,
            },
          })
        } catch (err) {
          logger.error({ error: err.message }, 'Instagram comment inbound orchestration error')
          results.push({ type: 'comment', error: err.message })
        }
      }
    }

    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'Instagram webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

// ==================== FACEBOOK WEBHOOKS ====================
app.get('/api/webhooks/facebook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN || getWhatsAppConfig().verifyToken
  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge)
  }
  return res.sendStatus(403)
})

app.post('/api/webhooks/facebook', async (req, res) => {
  try {
    const events = parseIncomingFacebookWebhook(req.body)
    const results = []

    for (const event of events) {
      if (!event.text) continue
      const channel = event.type === 'dm' ? 'facebook_messenger' : 'facebook_comment'
      try {
        const result = await ingestInboundMessage({
          channel,
          provider: event.provider,
          providerMessageId: event.message_id,
          from: event.from,
          to: event.post_id || event.to || null,
          content: event.text,
          contentType: 'text',
          rawPayload: event,
          name: event.from_username,
          visibility: event.type === 'comment' ? 'public' : 'private',
        })
        results.push({ type: event.type, contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
        await logActivity({
          type: event.type === 'dm' ? 'facebook_dm_inbound_message' : 'facebook_comment_inbound_message',
          agent_id: result.contact?.assigned_agent_id,
          meta: {
            from: event.from,
            message_id: event.message_id,
            post_id: event.post_id,
            contact_id: result.contact?.id,
            conversation_id: result.conversation?.id,
          },
        })
      } catch (err) {
        logger.error({ error: err.message }, 'Facebook inbound orchestration error')
        results.push({ type: event.type, error: err.message })
      }
    }

    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'Facebook webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

// ==================== TIKTOK WEBHOOKS ====================
app.post('/api/webhooks/tiktok', async (req, res) => {
  try {
    const events = parseIncomingTikTokWebhook(req.body)
    const results = []

    for (const event of events) {
      if (!event.text) continue
      try {
        const result = await ingestInboundMessage({
          channel: event.type === 'dm' ? 'tiktok_dm' : 'tiktok_comment',
          provider: event.provider,
          providerMessageId: event.message_id,
          from: event.from,
          to: event.video_id || null,
          content: event.text,
          contentType: 'text',
          rawPayload: event,
          name: event.from_username,
          visibility: event.type === 'comment' ? 'public' : 'private',
        })
        results.push({ type: event.type, contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
        await logActivity({
          type: event.type === 'dm' ? 'tiktok_dm_inbound_message' : 'tiktok_comment_inbound_message',
          agent_id: result.contact?.assigned_agent_id,
          meta: {
            from: event.from,
            message_id: event.message_id,
            video_id: event.video_id,
            contact_id: result.contact?.id,
            conversation_id: result.conversation?.id,
          },
        })
      } catch (err) {
        logger.error({ error: err.message }, 'TikTok inbound orchestration error')
        results.push({ type: event.type, error: err.message })
      }
    }

    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'TikTok webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

// ==================== X (TWITTER) WEBHOOKS ====================
app.post('/api/webhooks/x', async (req, res) => {
  try {
    const events = parseIncomingXWebhook(req.body)
    const results = []

    for (const event of events) {
      if (!event.text) continue
      try {
        const result = await ingestInboundMessage({
          channel: event.type === 'dm' ? 'x_dm' : 'x_mention',
          provider: event.provider,
          providerMessageId: event.message_id,
          from: event.from,
          to: event.tweet_id || null,
          content: event.text,
          contentType: 'text',
          rawPayload: event,
          name: event.from_username,
          visibility: event.type === 'mention' ? 'public' : 'private',
        })
        results.push({ type: event.type, contact_id: result.contact?.id, conversation_id: result.conversation?.id, message_id: result.message?.id })
        await logActivity({
          type: event.type === 'dm' ? 'x_dm_inbound_message' : 'x_mention_inbound_message',
          agent_id: result.contact?.assigned_agent_id,
          meta: {
            from: event.from,
            message_id: event.message_id,
            tweet_id: event.tweet_id,
            contact_id: result.contact?.id,
            conversation_id: result.conversation?.id,
          },
        })
      } catch (err) {
        logger.error({ error: err.message }, 'X inbound orchestration error')
        results.push({ type: event.type, error: err.message })
      }
    }

    if (isProduction) {
      res.sendStatus(200)
    } else {
      res.json({ received: true, results })
    }
  } catch (e) {
    logger.error({ error: e.message }, 'X webhook processing error')
    res.status(200).json({ received: true, error: e.message })
  }
})

app.get('/api/properties/:propertyId/distributions', authMiddleware, async (req, res) => {
  res.json(await findAll('distributions', d => d.property_id === req.params.propertyId && d.agent_id === req.user.id))
})

/**
 * Resolve which scored area a listing belongs to so the frontend can
 * chain into the existing /api/areas/:slug endpoint to fetch the full
 * Neighborhood Valuator payload. Returns null when nothing matches so
 * the UI can show a "no data yet" empty state.
 *
 * Match order (best-effort):
 *   1. Direct area_id link (set at listing creation for tenants who
 *      wired it up)
 *   2. Exact case-insensitive match against listing.neighborhood
 *   3. Exact case-insensitive match against listing.city
 *
 * Owner-scoped — only the listing's own agent can resolve.
 */
app.get('/api/listings/:id/area', authMiddleware, async (req, res) => {
  const property = await findOne('properties', (p) => p.id === req.params.id)
  if (!property) return res.status(404).json({ error: 'Listing not found' })
  if (property.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the listing owner can look this up' })
  }
  const wantedName = (property.neighborhood || property.city || '').toLowerCase().trim()

  const areas = await findAll('areas', (a) => a.status === 'scoring_enabled')
  let match = null
  if (property.area_id) {
    match = areas.find((a) => a.id === property.area_id) || null
  }
  if (!match && wantedName) {
    match = areas.find((a) => String(a.name || '').toLowerCase().trim() === wantedName) || null
  }
  if (!match && property.city) {
    match = areas.find((a) => String(a.name || '').toLowerCase().trim() === property.city.toLowerCase().trim()) || null
  }
  if (!match) return res.json({ area: null })
  res.json({ area: { id: match.id, slug: match.slug, name: match.name, name_ar: match.name_ar || null } })
})

/**
 * List public comment threads across every published post for this listing.
 *
 * Iterates the listing's distributions (per-platform published posts),
 * matches inbound conversation_messages whose raw_payload carries the
 * distribution's external post id (media_id / post_id / video_id /
 * tweet_id / post_urn), groups the messages by conversation, and returns
 * one thread per conversation with the platform badge attached. Outbound
 * replies belong to the same conversation and come back on the same row.
 */
app.get('/api/listings/:id/comments', authMiddleware, async (req, res) => {
  const listingId = req.params.id
  const property = await findOne('properties', (p) => p.id === listingId)
  if (!property) return res.status(404).json({ error: 'Listing not found' })
  if (property.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the listing owner can view its comments' })
  }

  const dists = await findAll(
    'distributions',
    (d) => d.property_id === listingId && d.status === 'published' && d.external_id,
  )
  if (!dists.length) {
    const empty = {}
    for (const c of COMMENT_CATEGORIES) empty[c] = 0
    return res.json({ threads: [], published_posts: 0, summary: empty })
  }

  // Map every external id to its distribution so we can label threads.
  const distByExternalId = new Map()
  for (const d of dists) distByExternalId.set(String(d.external_id), d)

  const publicChannels = new Set([
    'instagram_comment',
    'facebook_comment',
    'tiktok_comment',
    'x_mention',
    'linkedin_comment',
  ])

  // Optional filter: ?category=hot_lead,interest,investor
  const categoryFilter = String(req.query.category || '').trim()
  const wantedCategories = categoryFilter
    ? new Set(categoryFilter.split(',').map((s) => s.trim()).filter(Boolean))
    : null

  const messages = await findAll('conversation_messages', (m) => {
    if (!publicChannels.has(m.channel)) return false
    const raw = m.metadata?.raw_payload || {}
    const candidates = [
      raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id,
      m.metadata?.media_id, m.metadata?.post_id,
    ].filter(Boolean).map(String)
    return candidates.some((c) => distByExternalId.has(c))
  })

  // Roll-up summary across ALL messages (before the category filter so the
  // filter chips can still show counts for categories that would be hidden).
  const summary = {}
  for (const c of COMMENT_CATEGORIES) summary[c] = 0
  for (const m of messages) {
    if (m.direction !== 'inbound') continue
    const cat = m.category && COMMENT_CATEGORIES.includes(m.category) ? m.category : 'general'
    summary[cat] = (summary[cat] || 0) + 1
  }

  // Pre-load routing outcomes for every inbound classified message so we
  // can attach them to the response in a single pass.
  const inboundMessageIds = new Set(messages.filter((m) => m.direction === 'inbound').map((m) => m.id))
  const routings = inboundMessageIds.size
    ? await findAll('comment_routings', (r) => inboundMessageIds.has(r.message_id))
    : []
  const routingsByMessage = new Map()
  for (const r of routings) {
    if (!routingsByMessage.has(r.message_id)) routingsByMessage.set(r.message_id, [])
    routingsByMessage.get(r.message_id).push({
      id: r.id,
      category: r.category,
      route: r.route,
      outcomes: r.outcomes || [],
      created_at: r.created_at,
    })
  }

  // Group by conversation and attach the associated distribution.
  const threads = new Map()
  for (const m of messages) {
    // Apply category filter here (after summary, before thread build).
    if (wantedCategories && m.direction === 'inbound') {
      const cat = m.category || 'general'
      if (!wantedCategories.has(cat)) continue
    }
    const raw = m.metadata?.raw_payload || {}
    const externalId = [
      raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id,
    ].find((c) => c && distByExternalId.has(String(c)))
    const dist = externalId ? distByExternalId.get(String(externalId)) : null

    if (!threads.has(m.conversation_id)) {
      const conversation = await findOne('conversations', (c) => c.id === m.conversation_id)
      const contact = conversation ? await findOne('contacts', (c) => c.id === conversation.contact_id) : null
      threads.set(m.conversation_id, {
        conversation_id: m.conversation_id,
        conversation,
        contact: contact ? { id: contact.id, name: contact.name, avatar: contact.avatar || null } : null,
        platform: dist?.platform || null,
        channel: m.channel,
        external_post_id: externalId || null,
        distribution_url: dist?.landing_page || dist?.post_url || null,
        // Thread-level top category = most severe / highest-signal category
        // across inbound messages in the thread. Set below after sort.
        top_category: null,
        needs_agent_attention: false,
        messages: [],
      })
    }
    const thread = threads.get(m.conversation_id)
    if (m.needs_agent_attention) thread.needs_agent_attention = true
    thread.messages.push({
      id: m.id,
      direction: m.direction,
      content: m.content,
      created_at: m.created_at,
      author_name: m.metadata?.raw_payload?.from_username || null,
      status: m.status,
      category: m.category || null,
      sentiment: m.sentiment || null,
      category_confidence: m.category_confidence ?? null,
      category_source: m.category_source || null,
      suggested_reply: m.suggested_reply || null,
      suggested_reply_composed_at: m.suggested_reply_composed_at || null,
      needs_agent_attention: !!m.needs_agent_attention,
      priority: m.priority || null,
      is_hidden: !!m.is_hidden,
      routings: routingsByMessage.get(m.id) || [],
    })
  }

  // Category priority order for picking a thread's top category — matches
  // the routing importance (Complaint outranks Objection, etc.).
  const priorityOrder = ['complaint', 'hot_lead', 'objection', 'investor', 'interest', 'question', 'testimonial', 'referral', 'reaction', 'general', 'spam']

  const out = Array.from(threads.values()).map((t) => {
    t.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    t.last_activity_at = t.messages.at(-1)?.created_at || t.conversation?.updated_at || null
    const cats = t.messages.filter((m) => m.direction === 'inbound' && m.category).map((m) => m.category)
    for (const p of priorityOrder) {
      if (cats.includes(p)) { t.top_category = p; break }
    }
    return t
  })
  out.sort((a, b) => new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime())

  res.json({
    threads: out,
    published_posts: dists.length,
    summary,
    category_meta: CATEGORY_META,
  })
})

/**
 * Manually re-classify a single conversation message (agent override). Locks
 * category_source to 'manual' so the background AI worker won't overwrite it.
 */
app.post('/api/comments/:id/reclassify', authMiddleware, async (req, res) => {
  const row = await findOne('conversation_messages', (m) => m.id === req.params.id)
  if (!row) return res.status(404).json({ error: 'Message not found' })

  // Owner check via conversation → contact → listing distribution.
  const conv = await findOne('conversations', (c) => c.id === row.conversation_id)
  if (!conv) return res.status(404).json({ error: 'Conversation not found' })
  const contact = await findOne('contacts', (c) => c.id === conv.contact_id)
  const isOwner = contact?.assigned_agent_id === req.user.id
  if (!isOwner) {
    // Fall back: allow if the user is the owner of a distribution referenced
    // in this message's raw_payload.
    const raw = row.metadata?.raw_payload || {}
    const candidates = [raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id].filter(Boolean).map(String)
    const dist = candidates.length
      ? await findOne('distributions', (d) => candidates.includes(String(d.external_id)))
      : null
    if (!dist || dist.agent_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the listing owner can re-classify comments on their post' })
    }
  }

  const { category, sentiment } = req.body || {}
  if (!COMMENT_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. One of: ${COMMENT_CATEGORIES.join(', ')}` })
  }
  const nextSentiment = sentiment && COMMENT_SENTIMENTS.includes(sentiment) ? sentiment : (row.sentiment || 'neutral')

  await update('conversation_messages', (m) => m.id === row.id, (m) => ({
    ...m,
    category,
    sentiment: nextSentiment,
    category_confidence: 1,
    category_source: 'manual',
    category_matched_rule: 'manual_override',
    category_updated_at: new Date().toISOString(),
  }))
  const updated = await findOne('conversation_messages', (m) => m.id === row.id)
  await logActivity({
    type: 'comment_manually_reclassified',
    agent_id: req.user.id,
    meta: { message_id: row.id, category, sentiment: nextSentiment },
  })
  res.json({ message: updated })
})

app.get('/api/comment-classifier/config', authMiddleware, (_req, res) => {
  res.json({ categories: COMMENT_CATEGORIES, sentiments: COMMENT_SENTIMENTS, meta: CATEGORY_META })
})

/**
 * Aggregated Command Center payload for the operations screen.
 *
 * Returns:
 *   escalations       — hot leads waiting for reply, unresolved complaints,
 *                       unresolved objections
 *   pipeline          — opportunities auto-opened from social routing,
 *                       grouped by sub_pipeline (standard | investor)
 *   inquiries         — inquiries created by the router in the last 30d
 *   engagement        — aggregate reaction / referral counts across the
 *                       caller's published distributions
 *   ai_watching       — conversations currently under AI thread-watch
 *   testimonials      — testimonials_queue rows awaiting consent /
 *                       review / publish
 *   routing_activity  — last 100 comment_routings for the caller
 */
app.get('/api/command-center', authMiddleware, async (req, res) => {
  const agentId = req.user.id
  const since30d = Date.now() - 30 * 24 * 3600 * 1000

  // Escalations — surface anything the router flagged as needing attention.
  const flaggedMessages = await findAll('conversation_messages', (m) =>
    m.needs_agent_attention && !m.is_hidden
  )
  const flaggedForMe = []
  for (const m of flaggedMessages) {
    const raw = m.metadata?.raw_payload || {}
    const externalCandidates = [raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id].filter(Boolean).map(String)
    const dist = externalCandidates.length
      ? await findOne('distributions', (d) => externalCandidates.includes(String(d.external_id)))
      : null
    if (dist?.agent_id === agentId) {
      const property = dist.property_id ? await findOne('properties', (p) => p.id === dist.property_id) : null
      const conv = await findOne('conversations', (c) => c.id === m.conversation_id)
      const contact = conv?.contact_id ? await findOne('contacts', (c) => c.id === conv.contact_id) : null
      flaggedForMe.push({
        message_id: m.id,
        conversation_id: m.conversation_id,
        category: m.category,
        sentiment: m.sentiment,
        priority: m.priority || 'normal',
        content: (m.content || '').slice(0, 300),
        author_name: raw.from_username || raw.from || contact?.name || null,
        contact_id: contact?.id || null,
        listing_id: property?.id || null,
        listing_title: property?.title || null,
        platform: dist.platform,
        suggested_reply: m.suggested_reply || null,
        created_at: m.created_at,
      })
    }
  }

  // Group by category for the panel layout.
  const escalations = {
    complaints: flaggedForMe.filter((f) => f.category === 'complaint'),
    objections: flaggedForMe.filter((f) => f.category === 'objection'),
    hot_leads: flaggedForMe.filter((f) => f.category === 'hot_lead'),
    other: flaggedForMe.filter((f) => !['complaint', 'objection', 'hot_lead'].includes(f.category)),
  }

  // Router-created opportunities — split by sub_pipeline for the CRM tabs.
  const opps = await findAll('opportunities', (o) =>
    o.agent_id === agentId && o.origin === 'social_comment'
  )
  const pipeline = {
    standard: opps.filter((o) => (o.sub_pipeline || 'standard') === 'standard'),
    investor: opps.filter((o) => o.sub_pipeline === 'investor'),
    other: opps.filter((o) => o.sub_pipeline && !['standard', 'investor'].includes(o.sub_pipeline)),
  }

  // Inquiries created by the router.
  const inquiries = (await findAll('inquiries', (i) =>
    i.agent_id === agentId
    && i.origin === 'social_comment'
    && new Date(i.created_at).getTime() > since30d
  )).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Engagement roll-up — sum across the caller's published distributions.
  const myDists = await findAll('distributions', (d) => d.agent_id === agentId && d.status === 'published')
  const engagement = { reactions: 0, referrals: 0, mentions: 0, by_platform: {} }
  for (const d of myDists) {
    const c = d.engagement_counts || {}
    engagement.reactions += c.reactions || 0
    engagement.referrals += c.referrals || 0
    engagement.mentions += c.mentions || 0
    const p = d.platform || 'other'
    if (!engagement.by_platform[p]) engagement.by_platform[p] = { reactions: 0, referrals: 0, mentions: 0 }
    engagement.by_platform[p].reactions += c.reactions || 0
    engagement.by_platform[p].referrals += c.referrals || 0
    engagement.by_platform[p].mentions += c.mentions || 0
  }

  // AI-watched conversation threads on the caller's listings.
  const aiWatchedConvs = await findAll('conversations', (c) => c.ai_watching === true)
  const aiWatching = []
  for (const c of aiWatchedConvs.slice(0, 50)) {
    const contact = c.contact_id ? await findOne('contacts', (co) => co.id === c.contact_id) : null
    if (contact?.assigned_agent_id !== agentId) continue
    aiWatching.push({
      conversation_id: c.id,
      channel: c.source_channel,
      contact_name: contact?.name || null,
      last_message_preview: c.last_message_preview || '',
      last_message_at: c.last_message_at,
      ai_watch_started_at: c.ai_watch_started_at,
    })
  }

  // Testimonials queue.
  const testimonials = (await findAll('testimonials_queue', (t) => t.agent_id === agentId))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Recent routing activity for the caller.
  const myRoutings = (await findAll('comment_routings', (r) => r.agent_id === agentId))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 100)

  res.json({
    escalations,
    pipeline,
    inquiries,
    engagement,
    ai_watching: aiWatching,
    testimonials,
    routing_activity: myRoutings,
    summary: {
      escalations_total: flaggedForMe.length,
      pipeline_total: opps.length,
      inquiries_total: inquiries.length,
      testimonials_total: testimonials.length,
      ai_watching_total: aiWatching.length,
    },
  })
})

/**
 * Retro-classify: run the rules stage over every previously-ingested public
 * comment for this listing that has no category yet. One-shot backfill for
 * tenants who had comments landing before the classifier shipped.
 */
app.post('/api/listings/:id/comments/backfill-categories', authMiddleware, async (req, res) => {
  const property = await findOne('properties', (p) => p.id === req.params.id)
  if (!property || property.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorised' })
  }
  const dists = await findAll(
    'distributions',
    (d) => d.property_id === property.id && d.status === 'published' && d.external_id,
  )
  const distExternalIds = new Set(dists.map((d) => String(d.external_id)))
  const publicChannels = new Set(['instagram_comment', 'facebook_comment', 'tiktok_comment', 'x_mention', 'linkedin_comment'])

  const messages = await findAll('conversation_messages', (m) => {
    if (!publicChannels.has(m.channel)) return false
    if (m.category_source === 'manual') return false // never overwrite manual
    if (m.category) return false                     // already classified
    const raw = m.metadata?.raw_payload || {}
    const candidates = [raw.media_id, raw.post_id, raw.post_urn, raw.tweet_id, raw.video_id].filter(Boolean).map(String)
    return candidates.some((c) => distExternalIds.has(c))
  })

  let classified = 0
  for (const m of messages) {
    if (m.direction !== 'inbound' || !m.content) continue
    const r = classifyByRules(m.content)
    await update('conversation_messages', (row) => row.id === m.id, (row) => ({
      ...row,
      category: r.category,
      sentiment: r.sentiment,
      category_confidence: r.confidence,
      category_source: r.source,
      category_matched_rule: r.matched_rule,
      category_updated_at: new Date().toISOString(),
    }))
    classified++
  }
  res.json({ scanned: messages.length, classified })
})

/**
 * Refresh insights (views/likes/shares/comments) for a single published
 * distribution. Owner-only. Resolves per-tenant credentials, calls the
 * platform-specific insight fetcher, persists the metrics on the row.
 */
app.post('/api/distributions/:id/refresh-insights', authMiddleware, async (req, res) => {
  const dist = await findOne('distributions', (d) => d.id === req.params.id)
  if (!dist) return res.status(404).json({ error: 'Distribution not found' })
  if (dist.agent_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the distribution owner can refresh its insights' })
  }
  if (dist.status !== 'published' || !dist.external_id) {
    return res.status(400).json({ error: 'Distribution has no published external id yet' })
  }

  const conn = await findOne(
    'marketplace_connections',
    (c) => c.agent_id === req.user.id && c.platform === dist.platform,
  )
  const creds = conn ? resolveConnectionCredentials(conn) : null

  let metrics = null
  try {
    if (dist.platform === 'instagram') {
      metrics = await fetchInstagramInsights({
        mediaId: dist.external_id,
        accessToken: creds?.ig_page_access_token_override || undefined,
      })
    } else if (dist.platform === 'facebook') {
      metrics = await fetchFacebookInsights({
        postId: dist.external_id,
        accessToken: creds?.fb_page_access_token_override || undefined,
      })
    } else if (dist.platform === 'x') {
      metrics = await fetchXInsights({
        tweetId: dist.external_id,
        bearerToken: creds?.oauth_access_token || undefined,
      })
    } else if (dist.platform === 'linkedin') {
      metrics = await fetchLinkedInInsights({
        shareUrn: dist.external_id,
        authorUrn: creds?.li_author_urn || undefined,
        accessToken: creds?.li_access_token_override || undefined,
      })
    } else if (dist.platform === 'tiktok') {
      metrics = await fetchTikTokInsights({
        videoId: dist.external_id,
        accessToken: creds?.oauth_access_token || undefined,
      })
    } else {
      return res.status(400).json({ error: `Insights not supported for ${dist.platform} yet` })
    }
  } catch (err) {
    return res.status(502).json({ error: 'Insights fetch failed', detail: err.message })
  }

  await update('distributions', (d) => d.id === dist.id, (d) => ({
    ...d,
    insights: metrics,
    impressions: metrics?.impressions ?? d.impressions,
    reach: metrics?.reach ?? d.reach,
    likes: metrics?.likes ?? d.likes,
    comments_count: metrics?.comments ?? d.comments_count,
    shares: metrics?.shares ?? d.shares,
    saves: metrics?.saves ?? d.saves,
    clicks: metrics?.clicks ?? d.clicks,
    insights_fetched_at: metrics?.fetched_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  // Persist a snapshot every refresh — powers the time-series in the
  // Performance dashboard (Phase 4.9). Small rows, keyed by
  // (distribution_id, snapshot_at). Never mutated after insert.
  await insert('distribution_insight_snapshots', {
    id: uuidv4(),
    distribution_id: dist.id,
    listing_id: dist.property_id,
    agent_id: req.user.id,
    platform: dist.platform,
    impressions: metrics?.impressions ?? null,
    reach: metrics?.reach ?? null,
    likes: metrics?.likes ?? null,
    comments: metrics?.comments ?? null,
    shares: metrics?.shares ?? null,
    saves: metrics?.saves ?? null,
    clicks: metrics?.clicks ?? null,
    simulated: metrics?.simulated || false,
    snapshot_at: metrics?.fetched_at || new Date().toISOString(),
    source: metrics?.source || null,
  })

  await logActivity({
    type: 'distribution_insights_refreshed',
    agent_id: req.user.id,
    meta: { distribution_id: dist.id, platform: dist.platform, simulated: metrics?.simulated || false },
  })

  const updated = await findOne('distributions', (d) => d.id === dist.id)
  res.json({ distribution: updated, metrics })
})

app.post('/api/distributions/:id/retry', authMiddleware, async (req, res) => {
  const row = await findOne('distributions', d => d.id === req.params.id)
  if (!row) return res.status(404).json({ error: 'Distribution not found' })
  if (row.agent_id !== req.user.id && !await isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const retriableStatuses = ['pending_retry', 'failed', 'draft']
  if (!retriableStatuses.includes(row.status)) {
    return res.status(400).json({ error: `Distribution status '${row.status}' is not retriable` })
  }

  const updated = await retryDistributionDelivery(row, {
    requestedBy: req.user.id,
    source: 'manual_single',
  })
  res.json(updated)
})

app.post('/api/distributions/retry-pending', authMiddleware, async (req, res) => {
  const limitRaw = Number(req.body?.limit || 20)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 20
  const result = await processPendingDistributionRetries({
    limit,
    onlyDue: req.body?.due_only !== false,
    source: 'manual_bulk',
    requestedBy: req.user.id,
    agentId: req.user.id,
  })
  res.json(result)
})

app.post('/api/distributions/retry-worker/run', authMiddleware, async (req, res) => {
  const limitRaw = Number(req.body?.limit || RETRY_WORKER_BATCH_SIZE)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : RETRY_WORKER_BATCH_SIZE
  const onlyDue = req.body?.due_only !== false
  const scope = req.body?.scope === 'all' ? 'all' : 'self'

  if (scope === 'all' && !await isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'Only platform admins can run worker scope=all' })
  }

  const result = await processPendingDistributionRetries({
    limit,
    onlyDue,
    source: scope === 'all' ? 'manual_worker_run_all' : 'manual_worker_run_self',
    requestedBy: req.user.id,
    agentId: scope === 'all' ? null : req.user.id,
  })
  res.json(result)
})

app.post('/api/properties/:propertyId/submit-to-fi', authMiddleware, async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found' })
  if (prop.agent_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  const { platforms, message, formats } = req.body
  if (!platforms?.length) return res.status(400).json({ error: 'Select at least one REB channel' })

  const created = await Promise.all(platforms.map(async (platform) => {
    const fi = await findOne('platform_accounts', a => a.type === 'fi' && a.platform === platform)
    const submission = {
      id: uuidv4(),
      property_id: req.params.propertyId,
      agent_id: req.user.id,
      platform,
      platform_name: fi?.account_name || platform,
      platforms: [platform],
      formats: formats?.[platform] || [],
      message: message || '',
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    await insert('content_submissions', submission)
    await logActivity({
      type: 'fi_submission_created',
      property_id: req.params.propertyId,
      agent_id: req.user.id,
      meta: { submission_id: submission.id, platform },
    })
    return submission
  }))
  res.json(created.length === 1 ? created[0] : created)
})

async function enrichSubmission(sub) {
  const property = await findOne('properties', p => p.id === sub.property_id)
  const agent = await findOne('agents', a => a.id === sub.agent_id)
  return {
    ...sub,
    platform_name: sub.platform_name || sub.platform,
    property: property ? serializeProperty(property) : null,
    agent: agent ? serializeAgent(agent) : null,
  }
}

app.get('/api/my-submissions', authMiddleware, async (req, res) => {
  res.json((await findAll('content_submissions', s => s.agent_id === req.user.id)).map(enrichSubmission))
})

app.get('/api/distribution/performance', authMiddleware, async (req, res) => {
  const myDistributions = await findAll('distributions', d => d.agent_id === req.user.id)
  const mySubs = await findAll('content_submissions', s => s.agent_id === req.user.id)
  const byPlatformMap = {}
  myDistributions.forEach((d) => {
    const key = `${d.platform}-${d.owner_type || 'agency'}`
    if (!byPlatformMap[key]) {
      byPlatformMap[key] = {
        platform: d.platform,
        owner_type: d.owner_type || 'agency',
        listings: 0,
        views: 0,
        leads: 0,
        cost: 0,
      }
    }
    byPlatformMap[key].listings += 1
    byPlatformMap[key].views += d.views || 0
    byPlatformMap[key].leads += d.leads || 0
    byPlatformMap[key].cost += d.cost || 0
  })
  const published = myDistributions.filter(d => d.status === 'published')
  res.json({
    overview: {
      totalListingsPublished: new Set(published.map(d => d.property_id)).size,
      totalPlatforms: new Set(published.map(d => d.platform)).size,
      totalViews: published.reduce((s, d) => s + (d.views || 0), 0),
      totalLeads: published.reduce((s, d) => s + (d.leads || 0), 0),
      fiSubmissions: {
        pending: mySubs.filter(s => s.status === 'pending').length,
        approved: mySubs.filter(s => s.status === 'approved').length,
        rejected: mySubs.filter(s => s.status === 'rejected').length,
      },
    },
    byPlatform: Object.values(byPlatformMap),
    total: myDistributions.length,
  })
})

app.get('/api/activity-log', authMiddleware, async (req, res) => {
  const rows = (await findAll('activity_log', async a => a.agent_id === req.user.id || await isPlatformAdmin(req.user.id)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 100)
  res.json(rows)
})

// Admin review
app.get('/api/admin/submissions', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  res.json((await findAll('content_submissions', s => s.status === 'pending')).map(enrichSubmission))
})

app.post('/api/admin/submissions/:id/approve', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const sub = await findOne('content_submissions', s => s.id === req.params.id)
  if (!sub) return res.status(404).json({ error: 'Not found' })
  await update('content_submissions', s => s.id === req.params.id, s => ({
    ...s,
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    reviewed_by: req.user.id,
    review_notes: req.body.notes,
  }))
  await insert('distributions', {
    id: uuidv4(),
    property_id: sub.property_id,
    agent_id: sub.agent_id,
    platform: sub.platform,
    owner_type: 'reb',
    status: 'published',
    views: 0,
    leads: 0,
    clicks: 0,
    cost: 0,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  })
  await logActivity({
    type: 'fi_submission_approved',
    property_id: sub.property_id,
    agent_id: sub.agent_id,
    meta: { submission_id: sub.id, reviewed_by: req.user.id },
  })
  res.json({ success: true })
})

app.post('/api/admin/submissions/:id/reject', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const sub = await findOne('content_submissions', s => s.id === req.params.id)
  if (!sub) return res.status(404).json({ error: 'Not found' })
  await update('content_submissions', s => s.id === req.params.id, s => ({
    ...s,
    status: 'rejected',
    reviewed_at: new Date().toISOString(),
    reviewed_by: req.user.id,
    review_notes: req.body.notes,
  }))
  await logActivity({
    type: 'fi_submission_rejected',
    property_id: sub.property_id,
    agent_id: sub.agent_id,
    meta: { submission_id: sub.id, reviewed_by: req.user.id },
  })
  res.json({ success: true })
})

app.get('/api/admin/account-recovery', authMiddleware, async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const rows = await Promise.all((await findAll('account_recovery_cases'))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 300)
    .map(async (c) => {
      const agent = await findOne('agents', (a) => a.id === c.user_id)
      return {
        ...c,
        agent: agent ? serializeAgent(agent) : null,
      }
    }))
  res.json(rows)
})

app.post('/api/admin/account-recovery/:caseId/approve', authMiddleware, validate(accountRecoveryReviewSchema), async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const recoveryCase = await findOne('account_recovery_cases', (c) => c.id === req.params.caseId)
  if (!recoveryCase) return res.status(404).json({ error: 'Recovery case not found' })
  if (recoveryCase.status !== 'pending_review') {
    return res.status(400).json({ error: 'Recovery case is not pending review' })
  }

  const { token } = await issueRecoveryToken({
    userId: recoveryCase.user_id,
    email: recoveryCase.email,
    type: 'account_recovery',
    caseId: recoveryCase.id,
    ttlMinutes: 30,
    ip: req.ip,
    userAgent: req.get('user-agent') || null,
  })

  await update('account_recovery_cases', (c) => c.id === recoveryCase.id, (c) => ({
    ...c,
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: req.user.id,
    review_notes: req.validated.notes || '',
  }))

  await logActivity({
    type: 'account_recovery_approved',
    agent_id: recoveryCase.user_id,
    meta: { case_id: recoveryCase.id, reviewer_id: req.user.id },
  })

  res.json({
    success: true,
    case_id: recoveryCase.id,
    message: 'Recovery case approved and token issued.',
    ...(!isProduction ? {
      _dev_recovery_token: token,
      _dev_recovery_reset_payload: {
        case_id: recoveryCase.id,
        token,
      },
    } : {}),
  })
})

app.post('/api/admin/account-recovery/:caseId/reject', authMiddleware, validate(accountRecoveryReviewSchema), async (req, res) => {
  if (!await isPlatformAdmin(req.user.id)) return res.status(403).json({ error: 'Forbidden' })
  const recoveryCase = await findOne('account_recovery_cases', (c) => c.id === req.params.caseId)
  if (!recoveryCase) return res.status(404).json({ error: 'Recovery case not found' })
  if (recoveryCase.status !== 'pending_review') {
    return res.status(400).json({ error: 'Recovery case is not pending review' })
  }

  await update('account_recovery_cases', (c) => c.id === recoveryCase.id, (c) => ({
    ...c,
    status: 'rejected',
    rejected_at: new Date().toISOString(),
    rejected_by: req.user.id,
    review_notes: req.validated.notes || '',
  }))

  await logActivity({
    type: 'account_recovery_rejected',
    agent_id: recoveryCase.user_id,
    meta: { case_id: recoveryCase.id, reviewer_id: req.user.id },
  })

  res.json({ success: true, case_id: recoveryCase.id })
})

app.get('/api/properties/:id/share', async (req, res) => {
  const prop = await findOne('properties', p => p.id === req.params.id)
  if (!prop) return res.status(404).json({ error: 'Not found' })
  const photos = typeof prop.photos === 'string' ? prop.photos.split('|') : (prop.photos || [])
  res.json({
    title: prop.title,
    description: prop.description,
    price: prop.price,
    location: prop.location,
    url: `${await getPublicAppBase()}/property/${prop.id}`,
    image: photos[0] || null,
  })
})

// ==================== WHITE-LABEL: AGENCIES ====================
app.get('/api/agencies/search', async (req, res) => {
  const { q } = req.query
  let agencies = await findAll('agencies')
  if (q) {
    const s = String(q).toLowerCase()
    agencies = agencies.filter(a =>
      a.name?.toLowerCase().includes(s) ||
      a.email?.toLowerCase().includes(s) ||
      a.license_number?.toLowerCase().includes(s) ||
      a.city?.toLowerCase().includes(s)
    )
  }
  res.json(agencies.map(a => ({
    id: a.id,
    name: a.name,
    license_number: a.license_number,
    email: a.email,
    phone: a.phone,
    address: a.address,
    website: a.website,
    logo: a.logo,
    city: a.city,
  })))
})

app.post('/api/agencies/apply', validate(agencyApplySchema), async (req, res) => {
  const body = req.validated
  const agency = await findOne('agencies', a => a.id === body.agency_id)
  if (!agency) return res.status(404).json({ error: 'Agency not found' })

  const existing = await findOne('agency_applications', a =>
    a.agency_id === body.agency_id && a.agent_email === body.agent_email && a.status === 'pending'
  )
  if (existing) return res.status(409).json({ error: 'You already have a pending application to this agency' })

  const application = {
    id: uuidv4(),
    agency_id: body.agency_id,
    agent_email: body.agent_email,
    agent_name: body.agent_name,
    agent_phone: body.agent_phone,
    message: body.message,
    status: 'pending',
    created_at: new Date().toISOString(),
  }
  await insert('agency_applications', application)

  // In production: send email to agency owner/admin
  logger.info({ application_id: application.id, agency: agency.name, agent_email: body.agent_email, agent_name: body.agent_name }, 'Agency application received')

  res.json({ success: true, application, message: `Application sent to ${agency.name}. They will review and approve your request.` })
})

app.get('/api/agencies/:id/applications', authMiddleware, async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.params.id)
  if (!agency) return res.status(404).json({ error: 'Not found' })
  const member = await getAgencyMembership(agency.id, req.user.id)
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  res.json((await findAll('agency_applications', a => a.agency_id === agency.id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
})

app.post('/api/agencies/:id/applications/:appId/approve', authMiddleware, async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.params.id)
  if (!agency) return res.status(404).json({ error: 'Not found' })
  const member = await getAgencyMembership(agency.id, req.user.id)
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const appRecord = await findOne('agency_applications', a => a.id === req.params.appId && a.agency_id === agency.id)
  if (!appRecord) return res.status(404).json({ error: 'Application not found' })

  const role = req.body?.role
  const affiliationMode = req.body?.affiliation_mode
  if (!role || !affiliationMode) {
    return res.status(400).json({
      error: 'role and affiliation_mode are required; Tenant Admin must explicitly classify the relationship',
    })
  }
  if (role === 'owner') return res.status(400).json({ error: 'Ownership requires the ownership transfer workflow' })
  if (role === 'admin' && member.role !== 'owner') {
    return res.status(403).json({ error: 'Only a tenant owner can grant the admin role' })
  }

  const agent = await findOne('agents', a => a.email === appRecord.agent_email)
  if (!agent) return res.status(409).json({ error: 'Applicant must create an account before approval' })
  const check = await assertCanJoinAgency(agent.id, agency.id, { role, affiliationMode })
  if (!check.ok) return res.status(409).json({ error: check.error })

  await addAgencyMembership({
    agencyId: agency.id,
    userId: agent.id,
    role,
    affiliationMode,
    invitedBy: req.user.id,
  })
  await update('agency_applications', a => a.id === appRecord.id, a => ({
    ...a,
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: req.user.id,
    approved_role: role,
    affiliation_mode: affiliationMode,
  }))
  if (affiliationMode === 'exclusive') {
    await update('agents', a => a.id === agent.id, a => ({ ...a, agency_name: agency.name }))
  }

  res.json({ success: true })
})

app.post('/api/agencies/:id/applications/:appId/reject', authMiddleware, async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.params.id)
  if (!agency) return res.status(404).json({ error: 'Not found' })
  const member = await getAgencyMembership(agency.id, req.user.id)
  if (!member || !['owner', 'admin'].includes(member.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  await update('agency_applications', a => a.id === req.params.appId && a.agency_id === agency.id, a => ({ ...a, status: 'rejected', rejected_at: new Date().toISOString(), rejected_by: req.user.id }))
  res.json({ success: true })
})

app.post('/api/agencies', authMiddleware, validate(agencyCreateSchema), async (req, res) => {
  const body = req.validated
  const existingAff = await getActiveAffiliation(req.user.id)
  if (existingAff) return res.status(409).json({ error: 'End your current exclusive agency affiliation before creating another agency' })
  if (await findOne('agencies', a => a.name === body.name)) return res.status(409).json({ error: 'Agency name exists' })
  const id = uuidv4()
  const agency = {
    id,
    name: body.name,
    license_number: body.license_number,
    description: body.description,
    logo: body.logo,
    primary_color: body.primary_color,
    secondary_color: body.secondary_color,
    phone: body.phone,
    email: body.email,
    address: body.address,
    website: body.website,
    owner_id: req.user.id,
    site_hosting_type: body.site_hosting_type || 'none',
    created_at: new Date().toISOString(),
  }
  await createAgencyWithOwner({ agency, ownerUserId: req.user.id })
  res.json(agency)
})

app.get('/api/agencies/my', authMiddleware, async (req, res) => {
  const member = await getActiveAffiliation(req.user.id)
  if (!member) return res.json(null)
  const agency = await findOne('agencies', a => a.id === member.agency_id)
  if (!agency) return res.json(null)
  const members = await Promise.all((await findAll('agency_members', m => m.agency_id === agency.id)).map(async (m) => {
    const user = await findOne('agents', a => a.id === m.user_id)
    return { ...m, user: user ? serializeAgent(user) : null }
  }))
  res.json({ ...agency, members, myRole: member.role })
})

app.get('/api/agencies/:id', async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.params.id)
  if (!agency) return res.status(404).json({ error: 'Not found' })
  const members = await Promise.all((await findAll('agency_members', m => m.agency_id === agency.id && m.status === 'active')).map(async (m) => {
    const user = await findOne('agents', a => a.id === m.user_id)
    return { ...m, user: user ? serializeAgent(user) : null }
  }))
  const listings = (await findAll('properties', p => p.agency_id === agency.id || members.some(m => m.user_id === p.agent_id))).map(serializeProperty)
  res.json({ ...agency, members, listings })
})

app.put('/api/agencies/:id', authMiddleware, async (req, res) => {
  const member = await getAgencyMembership(req.params.id, req.user.id)
  if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Forbidden' })
  const allowed = ['name', 'license_number', 'description', 'logo', 'primary_color', 'secondary_color', 'phone', 'email', 'address', 'website', 'site_hosting_type', 'cta_config']
  const patch = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) patch[key] = req.body[key]
  }
  await update('agencies', a => a.id === req.params.id, a => ({ ...a, ...patch }))
  res.json(await findOne('agencies', a => a.id === req.params.id))
})

// Agency members
app.post('/api/agencies/:agencyId/members', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const { email, role, affiliation_mode: affiliationMode } = req.body
  if (!role || !affiliationMode) {
    return res.status(400).json({ error: 'role and affiliation_mode are required' })
  }
  if (role === 'owner') return res.status(400).json({ error: 'Ownership requires the ownership transfer workflow' })
  if (role === 'admin' && req.tenantMembership.role !== 'owner') {
    return res.status(403).json({ error: 'Only a tenant owner can grant the admin role' })
  }
  const user = await findOne('agents', a => a.email === email)
  if (!user) return res.status(404).json({ error: 'User not found' })
  const check = await assertCanJoinAgency(user.id, req.params.agencyId, { role, affiliationMode })
  if (!check.ok) return res.status(409).json({ error: check.error })
  const created = await addAgencyMembership({
    agencyId: req.params.agencyId,
    userId: user.id,
    role,
    affiliationMode,
    invitedBy: req.user.id,
  })
  res.json({ ...created.legacyMembership, tenant_membership: created.membership, user: serializeAgent(user) })
})

app.put('/api/agencies/:agencyId/members/:memberId', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  if (req.body.role === 'owner' || req.body.status !== undefined) {
    return res.status(400).json({
      error: 'Ownership and status changes require their dedicated workflows',
    })
  }
  if (req.body.role === 'admin' && req.tenantMembership.role !== 'owner') {
    return res.status(403).json({ error: 'Only a tenant owner can grant the admin role' })
  }
  try {
    const membership = await updateAgencyMembership({
      agencyId: req.params.agencyId,
      membershipId: req.params.memberId,
      role: req.body.role,
      affiliationMode: req.body.affiliation_mode,
      publicProfile: req.body.public_profile,
      leadEligible: req.body.lead_eligible,
      capabilities: req.body.capabilities,
    })
    res.json({ success: true, membership })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/agencies/:agencyId/members/:memberId/end', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const result = await endAffiliation(req.params.memberId, req.params.agencyId, {
    endedBy: req.user.id,
    reason: req.body.reason || 'departure',
  })
  if (!result.ok) return res.status(result.requires_reassignment ? 409 : 400).json(result)
  res.json(result)
})

app.get('/api/agencies/:agencyId/members/:memberId/tied-listings', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const member = await findOne('agency_members', m => m.id === req.params.memberId && m.agency_id === req.params.agencyId)
  if (!member) return res.status(404).json({ error: 'Membership not found' })
  const listings = (await findAll(
    'properties',
    (p) =>
      p.agent_id === member.user_id &&
      (p.agency_tied === true || p.agency_tied === 1) &&
      p.agency_id === req.params.agencyId &&
      p.status !== 'reassigned' &&
      p.status !== 'withdrawn',
  )).map((p) => ({ id: p.id, title: p.title, canonical_id: p.canonical_id || p.id, status: p.status || 'active', price: p.price }))
  res.json({ member_id: member.id, user_id: member.user_id, listings })
})

app.post('/api/agencies/:agencyId/listings/:propertyId/reassign', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const { from_agent_id, to_agent_id } = req.body
  if (!from_agent_id || !to_agent_id) return res.status(400).json({ error: 'from_agent_id and to_agent_id required' })
  const result = await reassignAgencyTiedListing(req.params.propertyId, {
    fromAgentId: from_agent_id,
    toAgentId: to_agent_id,
    agencyId: req.params.agencyId,
    actorId: req.user.id,
  })
  if (!result.ok) return res.status(400).json(result)
  res.json(result)
})

app.delete('/api/agencies/:agencyId/members/:memberId', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const result = await endAffiliation(req.params.memberId, req.params.agencyId, {
    endedBy: req.user.id,
    reason: 'removed',
  })
  if (!result.ok) return res.status(result.requires_reassignment ? 409 : 400).json(result)
  res.json({ success: true, ...result })
})

// ==================== WHITE-LABEL: SITES ====================
app.post('/api/white-label/sites', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.agencyId)
  if (agency && agency.site_hosting_type === 'none') {
    await update('agencies', a => a.id === req.agencyId, a => ({ ...a, site_hosting_type: 'whitelabel' }))
  }
  const { name, template_id, subdomain, custom_domain, brand_config } = req.body
  const hosting = await findOne('agencies', a => a.id === req.agencyId)
  if (custom_domain && hosting?.site_hosting_type !== 'whitelabel' && hosting?.site_hosting_type !== 'none') {
    // after flip above, none becomes whitelabel; still block external-only
  }
  if (custom_domain && hosting?.site_hosting_type === 'external') {
    return res.status(400).json({ error: 'Custom domains require site_hosting_type=whitelabel' })
  }
  const id = uuidv4()
  const site = {
    id, agency_id: req.agencyId, name, template_id, subdomain, custom_domain,
    brand_config: JSON.stringify(brand_config || {}),
    status: 'active', created_at: new Date().toISOString()
  }
  await insert('white_label_sites', site)
  res.json({ ...site, brand_config })
})

app.get('/api/white-label/sites', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const sites = await findAll('white_label_sites', s => s.agency_id === req.agencyId)
  res.json(sites.map(s => ({ ...s, brand_config: JSON.parse(s.brand_config || '{}') })))
})

app.get('/api/white-label/sites/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const site = await findOne('white_label_sites', s => s.id === req.params.id && s.agency_id === req.agencyId)
  if (!site) return res.status(404).json({ error: 'Not found' })
  res.json({ ...site, brand_config: JSON.parse(site.brand_config || '{}') })
})

app.put('/api/white-label/sites/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const site = await findOne('white_label_sites', s => s.id === req.params.id && s.agency_id === req.agencyId)
  if (!site) return res.status(404).json({ error: 'Not found' })
  let updates = { ...req.body }
  if (updates.brand_config) updates.brand_config = JSON.stringify(updates.brand_config)
  await update('white_label_sites', s => s.id === req.params.id, s => ({ ...s, ...updates }))
  res.json({ success: true })
})

app.delete('/api/white-label/sites/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  await remove('white_label_sites', s => s.id === req.params.id && s.agency_id === req.agencyId)
  res.json({ success: true })
})

// Templates
app.get('/api/white-label/templates', async (req, res) => {
  const templates = await findAll('templates')
  if (templates.length === 0) {
    const defaults = [
      { id: 'tpl-modern', name: 'Modern', description: 'Clean, contemporary design with large imagery', preview_image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400', features: 'hero-slider,property-grid,agent-cards,contact-form', category: 'residential' },
      { id: 'tpl-luxury', name: 'Luxury', description: 'Elegant dark theme for high-end properties', preview_image: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=400', features: 'full-screen-video,parallax,lifestyle-gallery,concierge', category: 'luxury' },
      { id: 'tpl-classic', name: 'Classic', description: 'Traditional layout with sidebar navigation', preview_image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400', features: 'sidebar,property-list,map-integration,testimonials', category: 'general' },
    ]
    await Promise.all(defaults.map(async (t) => insert('templates', t)))
    res.json(defaults)
  } else {
    res.json(templates)
  }
})

// Domains
app.post('/api/white-label/domains', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const { domain, type, site_id } = req.body
  const d = { id: uuidv4(), agency_id: req.agencyId, domain, type, site_id, status: 'pending', verified: 0, created_at: new Date().toISOString() }
  await insert('domains', d)
  res.json(d)
})

app.get('/api/white-label/domains', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  res.json(await findAll('domains', d => d.agency_id === req.agencyId))
})

// Lead routing rules
app.post('/api/white-label/routing-rules', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const rule = { id: uuidv4(), agency_id: req.agencyId, ...req.body, created_at: new Date().toISOString() }
  await insert('lead_routing_rules', rule)
  res.json(rule)
})

app.get('/api/white-label/routing-rules', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  res.json(await findAll('lead_routing_rules', r => r.agency_id === req.agencyId))
})

app.put('/api/white-label/routing-rules/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  await update('lead_routing_rules', r => r.id === req.params.id && r.agency_id === req.agencyId, r => ({ ...r, ...req.body }))
  res.json({ success: true })
})

app.delete('/api/white-label/routing-rules/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  await remove('lead_routing_rules', r => r.id === req.params.id && r.agency_id === req.agencyId)
  res.json({ success: true })
})

// Sync connections
app.post('/api/white-label/sync-connections', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const { name, type, config } = req.body
  const conn = {
    id: uuidv4(),
    agency_id: req.agencyId,
    name,
    type,
    config: typeof config === 'string' ? config : JSON.stringify(config || {}),
    source_of_truth: req.body.source_of_truth || 'external',
    status: 'active',
    last_sync: null,
    created_at: new Date().toISOString(),
  }
  await insert('sync_connections', conn)
  res.json({ ...conn, config: config || {} })
})

app.get('/api/white-label/sync-connections', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  res.json((await findAll('sync_connections', c => c.agency_id === req.agencyId)).map(c => ({
    ...c,
    config: typeof c.config === 'string' ? JSON.parse(c.config || '{}') : (c.config || {}),
  })))
})

app.delete('/api/white-label/sync-connections/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  await remove('sync_connections', c => c.id === req.params.id && c.agency_id === req.agencyId)
  res.json({ success: true })
})

app.post('/api/white-label/import-listings', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.agencyId)
  const agent = await findOne('agents', a => a.id === req.user.id)
  if (!agency || !agent) return res.status(400).json({ error: 'Agency context required' })
  const listings = await parseListingsPayload(req.body)
  const result = await importListingsForAgency({
    agencyId: agency.id,
    agentId: req.user.id,
    agencyName: agency.name,
    agentName: agent.name,
    agentPhoto: agent.photo,
    agentLicense: agent.license_number,
    listings,
    source: req.body.source || 'manual_import',
  })
  await insert('sync_logs', {
    id: uuidv4(),
    agency_id: agency.id,
    type: 'manual_import',
    result,
    created_at: new Date().toISOString(),
  })
  res.json(result)
})

app.post('/api/white-label/sync-connections/:id/run', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const conn = await findOne('sync_connections', c => c.id === req.params.id && c.agency_id === req.agencyId)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const agency = await findOne('agencies', a => a.id === req.agencyId)
  const agent = await findOne('agents', a => a.id === req.user.id)
  const config = typeof conn.config === 'string' ? JSON.parse(conn.config || '{}') : (conn.config || {})

  let listings = []
  let fetchError = null
  try {
    if (conn.type === 'json_api' && (config.endpoint || config.url)) {
      const url = config.endpoint || config.url
      const headers = { Accept: 'application/json' }
      if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`
      const upstream = await fetch(url, { headers })
      if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`)
      const data = await upstream.json()
      listings = await parseListingsPayload(data)
    } else if (conn.type === 'xml_feed' && config.url) {
      const upstream = await fetch(config.url)
      if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`)
      const xml = await upstream.text()
      listings = await parseSimpleXmlProperties(xml)
    } else if (config.sample_listings || req.body?.listings) {
      listings = await parseListingsPayload(req.body?.listings || config.sample_listings)
    } else {
      return res.status(400).json({
        error: 'No fetchable feed configured. Add endpoint/url, or paste listings via import, or set config.sample_listings.',
      })
    }
  } catch (err) {
    fetchError = err.message || String(err)
  }

  if (fetchError) {
    await insert('sync_logs', {
      id: uuidv4(),
      agency_id: req.agencyId,
      connection_id: conn.id,
      status: 'failed',
      error: fetchError,
      created_at: new Date().toISOString(),
    })
    await update('sync_connections', c => c.id === conn.id, c => ({ ...c, status: 'error', last_error: fetchError }))
    return res.status(502).json({ error: fetchError })
  }

  const result = await importListingsForAgency({
    agencyId: agency.id,
    agentId: req.user.id,
    agencyName: agency.name,
    agentName: agent.name,
    agentPhoto: agent.photo,
    agentLicense: agent.license_number,
    listings,
    source: conn.type,
  })
  const now = new Date().toISOString()
  await update('sync_connections', c => c.id === conn.id, c => ({
    ...c,
    status: 'active',
    last_sync: now,
    last_result: result,
    last_error: null,
  }))
  await insert('sync_logs', {
    id: uuidv4(),
    agency_id: req.agencyId,
    connection_id: conn.id,
    status: 'ok',
    result,
    created_at: now,
  })
  res.json({ connection_id: conn.id, ...result })
})

// Widgets
app.post('/api/white-label/widgets', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const { name, type, config, site_id } = req.body
  const id = uuidv4()
  const widget = { id, agency_id: req.agencyId, site_id, name, type, config: JSON.stringify(config || {}), created_at: new Date().toISOString() }
  await insert('widgets', widget)
  const embedCode = await generateWidgetEmbed(id, type, config)
  res.json({ ...widget, config, embed_code: embedCode })
})

app.get('/api/white-label/widgets', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const widgets = await findAll('widgets', w => w.agency_id === req.agencyId)
  res.json(await Promise.all(widgets.map(async (w) => ({
    ...w,
    config: JSON.parse(w.config || '{}'),
    embed_code: await generateWidgetEmbed(w.id, w.type, JSON.parse(w.config || '{}')),
  }))))
})

app.delete('/api/white-label/widgets/:id', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  await remove('widgets', w => w.id === req.params.id && w.agency_id === req.agencyId)
  res.json({ success: true })
})

app.get('/api/public/widgets/:id.js', async (req, res) => {
  const widget = await findOne('widgets', w => w.id === req.params.id)
  if (!widget) return res.status(404).type('text/plain').send('/* widget not found */')
  const agency = await findOne('agencies', a => a.id === widget.agency_id)
  const inventory = await getAgencyInventory(widget.agency_id).map(serializeProperty)
  const script = await buildWidgetBootstrapScript(widget, {
    listings: inventory,
    agency,
    appBase: await getPublicAppBase(),
    apiBase: await getPublicApiBase(),
  })
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.send(script)
})

// Analytics
app.post('/api/white-label/analytics', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const event = { id: uuidv4(), agency_id: req.agencyId, ...req.body, created_at: new Date().toISOString() }
  await insert('website_analytics', event)
  res.json({ success: true })
})

app.get('/api/white-label/analytics', authMiddleware, requireAnyAgencyRole, async (req, res) => {
  const events = await findAll('website_analytics', e => e.agency_id === req.agencyId)
  const byPage = {}
  const byDevice = {}
  events.forEach(e => {
    byPage[e.page] = (byPage[e.page] || 0) + 1
    byDevice[e.device] = (byDevice[e.device] || 0) + 1
  })
  res.json({ totalEvents: events.length, byPage, byDevice, events: events.slice(-100) })
})

// ==================== PUBLIC PAGES ====================
app.get('/api/public/agencies/:id', async (req, res) => {
  const agency = await findOne('agencies', a => a.id === req.params.id)
  if (!agency) return res.status(404).json({ error: 'Not found' })
  const members = await Promise.all((await findAll('agency_members', m => m.agency_id === agency.id)).map(async (m) => {
    const user = await findOne('agents', a => a.id === m.user_id)
    return { ...m, user: user ? serializeAgent(user) : null }
  }))
  const listings = (await findAll('properties', p => p.agent_id === agency.owner_id || members.some(m => m.user_id === p.agent_id))).map(serializeProperty)
  res.json({ ...agency, members, listings })
})

app.get('/api/public/agents/:id/portfolio', async (req, res) => {
  const agent = await findOne('agents', a => a.id === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Not found' })
  const membership = await findOne('agency_members', m => m.user_id === agent.id && m.status === 'active')
  const agency = membership ? await findOne('agencies', a => a.id === membership.agency_id) : null
  const listings = (await findAll('properties', p => p.agent_id === req.params.id)).map(serializeProperty)
  const reviews = await findAll('reviews', r => r.agent_id === req.params.id)
  const transactions = await findAll('transactions', t => t.agent_id === req.params.id)
  res.json({
    agent: serializeAgent(agent),
    agency,
    listings,
    reviews,
    transactions,
    sold_portfolio: transactions,
  })
})

app.get('/api/public/sites/by-subdomain/:subdomain', async (req, res) => {
  const site = await findOne('white_label_sites', s => s.subdomain === req.params.subdomain && s.status === 'active')
  if (!site) return res.status(404).json({ error: 'Site not found' })
  const agency = await findOne('agencies', a => a.id === site.agency_id)
  if (!agency) return res.status(404).json({ error: 'Agency not found' })
  const members = await findAll('agency_members', m => m.agency_id === agency.id && m.status === 'active')
  const memberIds = members.map(m => m.user_id)
  const listings = (await findAll('properties', p => memberIds.includes(p.agent_id) || p.agency_id === agency.id)).map(serializeProperty)
  const template = await findOne('templates', t => t.id === site.template_id)
  res.json({
    site: { ...site, brand_config: typeof site.brand_config === 'string' ? JSON.parse(site.brand_config || '{}') : (site.brand_config || {}) },
    agency,
    template,
    listings,
    agents: (await Promise.all(members.map(async (m) => {
      const user = await findOne('agents', a => a.id === m.user_id)
      return user ? serializeAgent(user) : null
    }))).filter(Boolean),
  })
})

app.get('/api/public/sites/by-subdomain/:subdomain/properties/:propertyId', async (req, res) => {
  const site = await findOne('white_label_sites', s => s.subdomain === req.params.subdomain && s.status === 'active')
  if (!site) return res.status(404).json({ error: 'Site not found' })
  const agency = await findOne('agencies', a => a.id === site.agency_id)
  if (!agency) return res.status(404).json({ error: 'Agency not found' })
  const inventory = await getAgencyInventory(agency.id)
  const prop = inventory.find(p => p.id === req.params.propertyId)
  if (!prop) return res.status(404).json({ error: 'Property not found on this site' })
  const agent = await findOne('agents', a => a.id === prop.agent_id)
  res.json({
    site: { ...site, brand_config: typeof site.brand_config === 'string' ? JSON.parse(site.brand_config || '{}') : (site.brand_config || {}) },
    agency,
    property: serializeProperty(prop),
    agent: agent ? serializeAgent(agent) : null,
  })
})

app.post('/api/public/sites/by-subdomain/:subdomain/events', async (req, res) => {
  const site = await findOne('white_label_sites', s => s.subdomain === req.params.subdomain && s.status === 'active')
  if (!site) return res.status(404).json({ error: 'Site not found' })
  const event = {
    id: uuidv4(),
    agency_id: site.agency_id,
    site_id: site.id,
    page: req.body.page || 'home',
    device: req.body.device || 'unknown',
    meta: req.body.meta || {},
    created_at: new Date().toISOString(),
  }
  await insert('website_analytics', event)
  res.json({ success: true })
})

app.get('/api/sitemap.xml', async (req, res) => {
  const props = await findAll('properties')
  const base = await getPublicAppBase()
  let xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  xml += `<url><loc>${escapeXml(`${base}/`)}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`
  xml += `<url><loc>${escapeXml(`${base}/search`)}</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`
  xml += `<url><loc>${escapeXml(`${base}/agents`)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`
  props.forEach(p => {
    xml += `<url><loc>${escapeXml(`${base}/property/${p.id}`)}</loc><lastmod>${escapeXml(p.listed_date)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`
  })
  xml += '</urlset>'
  res.set('Content-Type', 'application/xml')
  res.send(xml)
})

app.get('/api/robots.txt', async (req, res) => {
  const base = await getPublicAppBase()
  res.set('Content-Type', 'text/plain')
  res.send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml`)
})

// ==================== FEED ====================
app.get('/api/feed/properties.xml', async (req, res) => {
  const props = await findAll('properties')
  let xml = '<?xml version="1.0" encoding="UTF-8"?><properties>'
  props.forEach(p => {
    xml += '<property>'
    xml += `<id>${escapeXml(p.id)}</id>`
    xml += `<title>${escapeXml(p.title)}</title>`
    xml += `<price>${escapeXml(p.price)}</price>`
    xml += `<location>${escapeXml(p.location)}</location>`
    xml += `<type>${escapeXml(p.type)}</type>`
    xml += '</property>'
  })
  xml += '</properties>'
  res.set('Content-Type', 'application/xml')
  res.send(xml)
})

// ==================== HEALTH ====================
app.get('/api/health', async (req, res) => {
  const postgresHealth = await checkPostgresHealth()
  const readiness = {
    status: postgresHealth.ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    env: NODE_ENV,
    database: postgresHealth.ok ? 'ok' : 'unreachable',
    db_primary: 'postgres',
    auth: 'ok',
    whatsapp: isWhatsAppConfigured() ? 'configured' : 'not_configured',
    whatsapp_listings: whatsAppListingsModule.health ? await whatsAppListingsModule.health() : { enabled: false },
    retry_worker: {
      enabled: RETRY_WORKER_ENABLED,
      running: retryWorkerState.running,
      interval_ms: RETRY_WORKER_INTERVAL_MS,
      batch_size: RETRY_WORKER_BATCH_SIZE,
      max_attempts: RETRY_MAX_ATTEMPTS,
      last_run_at: retryWorkerState.last_run_at,
      last_processed: retryWorkerState.last_processed,
      last_error: retryWorkerState.last_error,
    },
    consumer_automation_worker: {
      enabled: CONSUMER_AUTOMATION_ENABLED,
      running: consumerAutomationState.running,
      interval_ms: CONSUMER_AUTOMATION_INTERVAL_MS,
      viewing_reminder_lead_minutes: VIEWING_REMINDER_LEAD_MINUTES,
      viewing_no_show_grace_minutes: VIEWING_NO_SHOW_GRACE_MINUTES,
      last_run_at: consumerAutomationState.last_run_at,
      last_result: consumerAutomationState.last_result,
      last_error: consumerAutomationState.last_error,
    },
    notification_retry_worker: {
      enabled: NOTIFICATION_RETRY_WORKER_ENABLED,
      running: notificationRetryWorkerState.running,
      interval_ms: NOTIFICATION_RETRY_WORKER_INTERVAL_MS,
      batch_size: NOTIFICATION_RETRY_WORKER_BATCH_SIZE,
      last_run_at: notificationRetryWorkerState.last_run_at,
      last_processed: notificationRetryWorkerState.last_processed,
      last_error: notificationRetryWorkerState.last_error,
    },
    campaign_scheduler: {
      enabled: CAMPAIGN_SCHEDULER_ENABLED,
      running: campaignSchedulerState.running,
      interval_ms: CAMPAIGN_SCHEDULER_INTERVAL_MS,
      batch_size: CAMPAIGN_SCHEDULER_BATCH_SIZE,
      last_run_at: campaignSchedulerState.last_run_at,
      last_processed: campaignSchedulerState.last_processed,
      last_error: campaignSchedulerState.last_error,
    },
    tiktok: isTikTokEnabled() ? 'enabled' : 'disabled',
    x: isXEnabled() ? 'enabled' : 'disabled',
  }
  res.status(postgresHealth.ok ? 200 : 503).json(readiness)
})

app.get('/api/ready', async (req, res) => {
  const postgresHealth = await checkPostgresHealth()
  res.status(postgresHealth.ok ? 200 : 503).json({
    ready: postgresHealth.ok,
    timestamp: new Date().toISOString(),
    env: NODE_ENV,
    services: {
      database: postgresHealth.ok ? 'ok' : 'unreachable',
      db_primary: 'postgres',
      auth: 'ok',
      whatsapp: isWhatsAppConfigured() ? 'configured' : 'not_configured',
      whatsapp_listings: whatsAppListingsModule.health ? await whatsAppListingsModule.health() : { enabled: false },
      market_pricing: marketPricingModule.health ? marketPricingModule.health() : { enabled: false },
      retry_worker: RETRY_WORKER_ENABLED ? 'enabled' : 'disabled',
      consumer_automation_worker: CONSUMER_AUTOMATION_ENABLED ? 'enabled' : 'disabled',
      notification_retry_worker: NOTIFICATION_RETRY_WORKER_ENABLED ? 'enabled' : 'disabled',
      campaign_scheduler: CAMPAIGN_SCHEDULER_ENABLED ? 'enabled' : 'disabled',
      tiktok: isTikTokEnabled() ? 'enabled' : 'disabled',
      x: isXEnabled() ? 'enabled' : 'disabled',
    },
  })
})

// ==================== ERROR HANDLING ====================
app.use((err, req, res, _next) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path, method: req.method }, 'Unhandled error')
  const status = err.status || err.statusCode || 500
  const message = isProduction ? 'Internal server error' : (err.message || 'Internal server error')
  res.status(status).json({ error: message })
})

// ==================== START ====================
const startServer = async () => {
  const port = await resolveServerPort()

  app.listen(port, () => {
    logger.info({
      port,
      env: NODE_ENV,
      whatsappConfigured: isWhatsAppConfigured(),
      retryWorkerEnabled: RETRY_WORKER_ENABLED,
      retryWorkerIntervalMs: RETRY_WORKER_INTERVAL_MS,
      retryWorkerBatchSize: RETRY_WORKER_BATCH_SIZE,
      consumerAutomationWorkerEnabled: CONSUMER_AUTOMATION_ENABLED,
      consumerAutomationWorkerIntervalMs: CONSUMER_AUTOMATION_INTERVAL_MS,
      notificationRetryWorkerEnabled: NOTIFICATION_RETRY_WORKER_ENABLED,
      notificationRetryWorkerIntervalMs: NOTIFICATION_RETRY_WORKER_INTERVAL_MS,
      campaignSchedulerEnabled: CAMPAIGN_SCHEDULER_ENABLED,
      campaignSchedulerIntervalMs: CAMPAIGN_SCHEDULER_INTERVAL_MS,
      campaignSchedulerBatchSize: CAMPAIGN_SCHEDULER_BATCH_SIZE,
      auditLogRetentionDays: AUDIT_LOG_RETENTION_DAYS,
      activityLogRetentionDays: ACTIVITY_LOG_RETENTION_DAYS,
    }, 'REB API running')

    if (RETRY_WORKER_ENABLED) {
      retryWorkerTimer = setInterval(async () => {
        if (retryWorkerState.running) return
        retryWorkerState.running = true
        retryWorkerState.last_error = null
        try {
          const result = await processPendingDistributionRetries({
            limit: RETRY_WORKER_BATCH_SIZE,
            onlyDue: true,
            source: 'worker_scheduler',
            requestedBy: 'system',
          })
          retryWorkerState.last_run_at = new Date().toISOString()
          retryWorkerState.last_processed = result.processed
          if (result.processed > 0) {
            logger.info({ processed: result.processed, published: result.published, failed: result.failed, requeued: result.requeued }, 'Distribution retry worker processed queue')
          }
        } catch (err) {
          retryWorkerState.last_run_at = new Date().toISOString()
          retryWorkerState.last_error = err.message || String(err)
          logger.error({ err: err.message || String(err) }, 'Distribution retry worker failed')
        } finally {
          retryWorkerState.running = false
        }
      }, RETRY_WORKER_INTERVAL_MS)

      if (typeof retryWorkerTimer.unref === 'function') {
        retryWorkerTimer.unref()
      }
    }

    if (CONSUMER_AUTOMATION_ENABLED) {
      consumerAutomationWorkerTimer = setInterval(async () => {
        if (consumerAutomationState.running) return
        consumerAutomationState.running = true
        consumerAutomationState.last_error = null
        try {
          const result = await processConsumerJourneyAutomation({
            source: 'worker_scheduler',
            requestedBy: 'system',
          })
          consumerAutomationState.last_run_at = new Date().toISOString()
          consumerAutomationState.last_result = result
          if ((result.searches_processed || 0) > 0 || (result.inquiry_overdue_marked || 0) > 0 || (result.reminders_sent || 0) > 0 || (result.no_shows_marked || 0) > 0) {
            logger.info(result, 'Consumer automation worker processed jobs')
          }
        } catch (err) {
          consumerAutomationState.last_run_at = new Date().toISOString()
          consumerAutomationState.last_error = err.message || String(err)
          consumerAutomationState.metrics.total_failures += 1
          logger.error({ err: err.message || String(err) }, 'Consumer automation worker failed')
        } finally {
          consumerAutomationState.running = false
        }
      }, CONSUMER_AUTOMATION_INTERVAL_MS)

      if (typeof consumerAutomationWorkerTimer.unref === 'function') {
        consumerAutomationWorkerTimer.unref()
      }
    }

    if (NOTIFICATION_RETRY_WORKER_ENABLED) {
      notificationRetryWorkerTimer = setInterval(async () => {
        if (notificationRetryWorkerState.running) return
        notificationRetryWorkerState.running = true
        notificationRetryWorkerState.last_error = null
        try {
          const result = await processPendingNotificationRetries({
            limit: NOTIFICATION_RETRY_WORKER_BATCH_SIZE,
          })
          notificationRetryWorkerState.last_run_at = new Date().toISOString()
          notificationRetryWorkerState.last_processed = result.processed
          if (result.processed > 0) {
            logger.info({ processed: result.processed, results: result.results }, 'Notification retry worker processed queue')
          }
        } catch (err) {
          notificationRetryWorkerState.last_run_at = new Date().toISOString()
          notificationRetryWorkerState.last_error = err.message || String(err)
          logger.error({ err: err.message || String(err) }, 'Notification retry worker failed')
        } finally {
          notificationRetryWorkerState.running = false
        }
      }, NOTIFICATION_RETRY_WORKER_INTERVAL_MS)

      if (typeof notificationRetryWorkerTimer.unref === 'function') {
        notificationRetryWorkerTimer.unref()
      }
    }

    if (CAMPAIGN_SCHEDULER_ENABLED) {
      campaignSchedulerTimer = setInterval(async () => {
        if (campaignSchedulerState.running) return
        campaignSchedulerState.running = true
        campaignSchedulerState.last_error = null
        try {
          const result = await runCampaignScheduler({ maxEnrollments: CAMPAIGN_SCHEDULER_BATCH_SIZE })
          campaignSchedulerState.last_run_at = new Date().toISOString()
          campaignSchedulerState.last_processed = result.processed
          if (result.processed > 0) {
            logger.info(result, 'Campaign scheduler processed enrollments')
          }
        } catch (err) {
          campaignSchedulerState.last_run_at = new Date().toISOString()
          campaignSchedulerState.last_error = err.message || String(err)
          logger.error({ err: err.message || String(err) }, 'Campaign scheduler failed')
        } finally {
          campaignSchedulerState.running = false
        }
      }, CAMPAIGN_SCHEDULER_INTERVAL_MS)

      if (typeof campaignSchedulerTimer.unref === 'function') {
        campaignSchedulerTimer.unref()
      }
    }

    if (COMMENT_CLASSIFIER_AI_ENABLED) {
      commentClassifierTimer = setInterval(async () => {
        try {
          const r = await runCommentClassifierBatch()
          if (r?.updated) {
            logger.info(r, 'Comment classifier AI batch updated rows')
          }
        } catch (err) {
          logger.error({ err: err.message || String(err) }, 'Comment classifier worker failed')
        }
      }, COMMENT_CLASSIFIER_INTERVAL_MS)
      if (typeof commentClassifierTimer.unref === 'function') {
        commentClassifierTimer.unref()
      }
    }
  })
}

void startServer()
