import { z } from 'zod'

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return res.status(400).json({ error: 'Validation failed', issues })
    }
    req.validated = result.data
    next()
  }
}

export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query)
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return res.status(400).json({ error: 'Invalid query parameters', issues })
    }
    req.validatedQuery = result.data
    next()
  }
}

export const emailSchema = z.string().email().max(255).transform((v) => v.trim().toLowerCase())

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: emailSchema,
  phone: z.string().max(40).optional().default(''),
  password: z.string().min(6).max(128),
  license_number: z.string().max(80).optional().default(''),
  agency_name: z.string().max(120).optional().default(''),
  agency_license: z.string().max(80).optional().default(''),
  specialization: z.string().max(120).optional().default(''),
  languages: z.string().max(120).optional().default(''),
  bio: z.string().max(2000).optional().default(''),
  office_address: z.string().max(300).optional().default(''),
  agency_mode: z.enum(['existing', 'new', 'none']).optional().default('none'),
  territories: z.array(z.string().max(120)).max(100).optional().default([]),
  property_types: z.array(z.string().max(120)).max(100).optional().default([]),
  otp_verified: z.boolean().optional().default(false),
  terms_accepted: z.boolean().optional().default(false),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

export const passwordForgotSchema = z.object({
  email: emailSchema,
})

export const passwordResetSchema = z.object({
  token: z.string().min(24).max(512),
  password: z.string().min(10).max(128),
})

export const passwordChangeSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(10).max(128),
})

export const accountRecoveryRequestSchema = z.object({
  email: emailSchema,
  reason: z.string().min(10).max(2000),
  preferred_channel: z.enum(['email', 'whatsapp']).optional().default('email'),
  contact: z.string().min(3).max(120).optional().default(''),
})

export const accountRecoveryReviewSchema = z.object({
  notes: z.string().max(2000).optional().default(''),
})

export const accountRecoveryCompleteSchema = z.object({
  case_id: z.string().min(8).max(120),
  token: z.string().min(24).max(512),
  password: z.string().min(10).max(128),
})

export const otpSendSchema = z.object({
  channel: z.enum(['whatsapp', 'email', 'gmail', 'facebook']),
  contact: z.string().min(3).max(120),
})

export const otpVerifySchema = z.object({
  contact: z.string().min(3).max(120),
  code: z.string().min(4).max(10),
})

export const propertyCreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional().default(''),
  type: z.enum(['sale', 'rent']),
  property_type: z.string().min(1).max(60),
  price: z.coerce.number().int().nonnegative().max(1000000000),
  price_unit: z.string().max(20).optional().default(''),
  bedrooms: z.coerce.number().int().nonnegative().max(50).optional().default(0),
  bathrooms: z.coerce.number().int().nonnegative().max(50).optional().default(0),
  area: z.coerce.number().nonnegative().max(1000000).optional().nullable().default(null),
  area_unit: z.string().max(20).optional().default('sqm'),
  location: z.string().max(200).optional().default(''),
  city: z.string().max(100).optional().default(''),
  neighborhood: z.string().max(100).optional().default(''),
  address: z.string().max(300).optional().default(''),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable().default(null),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable().default(null),
  amenities: z.array(z.string().max(50)).max(50).optional().default([]),
  furnished: z.number().int().min(0).max(1).optional().default(0),
  photos: z.array(z.string().url().max(1000)).max(50).optional().default([]),
  media: z.array(z.object({
    id: z.string().max(80).optional(),
    url: z.string().url().max(1000),
    media_type: z.enum(['image', 'video']).optional().default('image'),
    classification: z.string().max(60).optional().default('Other'),
    source: z.string().max(40).optional().default('link'),
  })).max(50).optional().default([]),
  canonical_id: z.string().max(80).optional(),
  territory_id: z.string().max(40).optional().default('territory-lb'),
  agency_tied: z.boolean().optional().default(false),
  marketplace_syndicated: z.boolean().optional().default(true),
  ungroup_override: z.boolean().optional().default(false),
  classification: z.string().max(60).optional(),
  permissible_buildup_area: z.coerce.number().nonnegative().max(1000000).optional().nullable().default(null),
  developed_by: z.string().max(120).optional().default(''),
  interior_design_by: z.string().max(120).optional().default(''),
  status: z.enum(['active', 'draft', 'sold', 'rented', 'withdrawn', 'expired', 'hold', 'unpublished']).optional().default('active'),
  permit_number: z.string().max(80).optional().default(''),
  reference: z.string().max(80).optional().default(''),
  featured: z.boolean().optional().default(false),
})

export const propertyUpdateSchema = propertyCreateSchema.partial()

export const inquirySchema = z.object({
  property_id: z.string().max(80).optional().nullable(),
  name: z.string().min(2).max(120),
  email: z.string().email().max(255),
  phone: z.string().max(40).optional().default(''),
  message: z.string().min(10).max(3000),
  property_title: z.string().max(200).optional().default(''),
  source: z.string().max(60).optional().default('marketplace'),
  channel: z.string().max(40).optional().default('web'),
  agency_id: z.string().max(80).optional().nullable(),
  site_id: z.string().max(80).optional().nullable(),
  landing_page: z.string().max(500).optional().default(''),
  contact_mode: z.enum(['direct', 'platform_routed']).optional().default('direct'),
})

export const inquiryUpdateSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'scheduled_viewing', 'negotiating', 'closed_won', 'closed_lost']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  stage: z.enum(['new', 'first_response', 'qualification', 'viewing', 'offer', 'closed']).optional(),
  assigned_to: z.string().max(80).optional().nullable(),
  first_response_at: z.string().datetime().optional().nullable(),
  next_follow_up_at: z.string().datetime().optional().nullable(),
  lost_reason: z.string().max(500).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
})

export const viewingCreateSchema = z.object({
  inquiry_id: z.string().max(80),
  property_id: z.string().max(80).optional().nullable(),
  scheduled_at: z.string().datetime(),
  duration_minutes: z.coerce.number().int().min(15).max(240).optional().default(45),
  mode: z.enum(['in_person', 'virtual']).optional().default('in_person'),
  location: z.string().max(300).optional().default(''),
  notes: z.string().max(2000).optional().default(''),
})

export const viewingUpdateSchema = z.object({
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
  scheduled_at: z.string().datetime().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(240).optional(),
  mode: z.enum(['in_person', 'virtual']).optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(2000).optional().default(''),
  outcome: z.enum(['interested', 'not_interested', 'no_show', 'cancelled']).optional().nullable(),
  outcome_notes: z.string().max(2000).optional().nullable(),
  notify_client: z.boolean().optional().default(false),
  notify_channel: z.enum(['email', 'whatsapp', 'sms']).optional().nullable(),
})

export const savedSearchCreateSchema = z.object({
  name: z.string().min(2).max(160),
  filters: z.record(z.unknown()).optional().default({}),
  alert_enabled: z.boolean().optional().default(true),
  alert_channel: z.enum(['email', 'whatsapp', 'inapp']).optional().default('inapp'),
  alert_frequency: z.enum(['instant', 'daily', 'weekly']).optional().default('daily'),
})

export const savedSearchUpdateSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  filters: z.record(z.unknown()).optional(),
  alert_enabled: z.boolean().optional(),
  alert_channel: z.enum(['email', 'whatsapp', 'inapp']).optional(),
  alert_frequency: z.enum(['instant', 'daily', 'weekly']).optional(),
})

export const agencyCreateSchema = z.object({
  name: z.string().min(2).max(120),
  license_number: z.string().max(80).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  logo: z.string().url().max(1000).optional().default(''),
  primary_color: z.string().max(20).optional().default(''),
  secondary_color: z.string().max(20).optional().default(''),
  phone: z.string().max(40).optional().default(''),
  email: z.string().email().max(255).optional().default(''),
  address: z.string().max(300).optional().default(''),
  website: z.string().url().max(500).optional().default(''),
  site_hosting_type: z.enum(['none', 'whitelabel', 'external']).optional().default('none'),
})

export const agencyApplySchema = z.object({
  agency_id: z.string().max(80),
  agent_email: emailSchema,
  agent_name: z.string().max(120).optional().default(''),
  agent_phone: z.string().max(40).optional().default(''),
  message: z.string().max(2000).optional().default(''),
})

export const propertyQuerySchema = z.object({
  city: z.string().max(100).optional(),
  neighborhood: z.string().max(100).optional(),
  type: z.enum(['sale', 'rent']).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  bedrooms: z.coerce.number().int().nonnegative().max(50).optional(),
  agentId: z.string().max(80).optional(),
  featured: z.string().max(10).optional(),
  search: z.string().max(200).optional(),
  propertyType: z.string().max(60).optional(),
  property_type: z.string().max(60).optional(),
  include_unsyndicated: z.string().max(10).optional(),
})

export const notificationPrefsUpdateSchema = z.object({
  channels: z.object({
    inapp: z.boolean().optional(),
    email: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
  }).optional(),
  events: z.object({
    saved_search_match: z.boolean().optional(),
    inquiry_sla_overdue: z.boolean().optional(),
    viewing_reminder: z.boolean().optional(),
    viewing_no_show: z.boolean().optional(),
  }).optional(),
  quiet_hours: z.object({
    enabled: z.boolean().optional(),
    start: z.string().max(5).optional(),
    end: z.string().max(5).optional(),
    timezone: z.string().max(80).optional(),
  }).optional(),
})

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  unread_only: z.enum(['true', 'false', '1', '0']).optional(),
})

export const inquiryQuerySchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'scheduled_viewing', 'negotiating', 'closed_won', 'closed_lost']).optional(),
  stage: z.enum(['new', 'first_response', 'qualification', 'viewing', 'offer', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
})

export const taskCreateSchema = z.object({
  contact_id: z.string().max(80).optional().nullable(),
  inquiry_id: z.string().max(80).optional().nullable(),
  opportunity_id: z.string().max(80).optional().nullable(),
  conversation_id: z.string().max(80).optional().nullable(),
  assigned_to: z.string().max(80).optional().nullable(),
  type: z.enum(['call', 'email', 'follow_up', 'viewing', 'meeting']).optional().default('follow_up'),
  title: z.string().min(2).max(200),
  notes: z.string().max(2000).optional().default(''),
  due_at: z.string().datetime(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
})

export const taskUpdateSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  notes: z.string().max(2000).optional(),
  due_at: z.string().datetime().optional(),
  status: z.enum(['pending', 'completed', 'cancelled', 'snoozed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigned_to: z.string().max(80).optional().nullable(),
}).strict()

export const opportunityCreateSchema = z.object({
  contact_id: z.string().min(8).max(80),
  property_id: z.string().max(80).optional().nullable(),
  stage: z.enum(['new', 'qualification', 'viewing', 'offer', 'negotiation', 'closed_won', 'closed_lost']).optional().default('new'),
  deal_value: z.coerce.number().int().nonnegative().max(1000000000).optional().nullable(),
  currency: z.string().max(3).optional().default('USD'),
  probability: z.coerce.number().int().min(0).max(100).optional().nullable(),
  expected_close_date: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().default(''),
})

export const opportunityUpdateSchema = z.object({
  stage: z.enum(['new', 'qualification', 'viewing', 'offer', 'negotiation', 'closed_won', 'closed_lost']).optional(),
  deal_value: z.coerce.number().int().nonnegative().max(1000000000).optional().nullable(),
  currency: z.string().max(3).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional().nullable(),
  expected_close_date: z.string().datetime().optional().nullable(),
  lost_reason: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  agent_id: z.string().max(80).optional().nullable(),
}).strict()

export const contactNoteSchema = z.object({
  content: z.string().min(2).max(3000),
})

export const taskQuerySchema = z.object({
  status: z.enum(['pending', 'completed', 'cancelled', 'snoozed']).optional(),
  due_before: z.string().datetime().optional(),
  due_after: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

export const messageTemplateCreateSchema = z.object({
  name: z.string().min(2).max(160),
  channel: z.enum(['whatsapp', 'sms', 'email']),
  category: z.enum(['greeting', 'follow_up', 'viewing', 'offer', 'general']).optional().default('general'),
  subject: z.string().max(300).optional().nullable(),
  body: z.string().min(1).max(5000),
  language: z.string().max(10).optional().default('en'),
  approval_status: z.enum(['draft', 'pending', 'approved', 'rejected']).optional().default('draft'),
  owner_type: z.enum(['agent', 'agency', 'platform']).optional().default('agent'),
  owner_id: z.string().max(80).optional().nullable(),
  is_default: z.boolean().optional().default(false),
})

export const messageTemplateUpdateSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  channel: z.enum(['whatsapp', 'sms', 'email']).optional(),
  category: z.enum(['greeting', 'follow_up', 'viewing', 'offer', 'general']).optional(),
  subject: z.string().max(300).optional().nullable(),
  body: z.string().min(1).max(5000).optional(),
  language: z.string().max(10).optional(),
  approval_status: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
  is_default: z.boolean().optional(),
}).strict()

export const messageTemplateRenderSchema = z.object({
  variables: z.record(z.string().max(1000)).optional().default({}),
})
