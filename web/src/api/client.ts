import type {
  AgencyPricingPortfolio,
  AgentPriceReport,
  AgentPricingPortfolio,
  PricingAnalysis,
  PricingDecision,
  PricingRecalculationJob,
  PricingTrendSnapshot,
} from '@/types/marketPricing'

function resolveApiBase() {
  const configured = String(import.meta.env.VITE_API_URL || '').trim()
  if (configured) return configured.replace(/\/$/, '')

  // Local developer default (works with Vite proxy in vite.config.ts)
  return '/api'
}

export const API_BASE = resolveApiBase()

const TOKEN_KEY = 'fi_token'

function getToken() {
  const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('sa_token')
  if (token && !localStorage.getItem(TOKEN_KEY) && localStorage.getItem('sa_token')) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.removeItem('sa_token')
  }
  return token
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('sa_token')
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.removeItem('sa_token')
}

function headers() {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

async function fetchJson(path: string, options?: RequestInit) {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options?.headers || {}) },
  })
  const bodyText = await res.text()
  const contentType = res.headers.get('content-type') || ''
  const isLikelyHtml = /^\s*</.test(bodyText)

  const parseJson = () => {
    if (!bodyText) return null
    try {
      return JSON.parse(bodyText)
    } catch {
      return null
    }
  }

  if (!res.ok) {
    const err = parseJson() || {
      error: isLikelyHtml
        ? `API responded with HTML instead of JSON (${res.status}) at ${url}. Check VITE_API_URL for this environment.`
        : `Request failed (${res.status})`,
      status: res.status,
      url,
    }
    const error = new Error((err as any).error || `HTTP ${res.status}`) as Error & Record<string, unknown>
    Object.assign(error, err as Record<string, unknown>)
    throw error
  }

  if (!bodyText) return null

  const parsed = parseJson()
  if (parsed !== null) return parsed

  if (isLikelyHtml || !contentType.includes('application/json')) {
    throw new Error(`API responded with non-JSON payload at ${url}. Check VITE_API_URL and backend routing.`)
  }

  throw new Error(`Failed to parse JSON response from ${url}`)
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    fetchJson('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data: Record<string, unknown>) =>
    fetchJson('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => fetchJson('/auth/me'),
  updateProfile: (data: Record<string, unknown>) =>
    fetchJson('/auth/me', { method: 'PUT', body: JSON.stringify(data) }),
  getOnboarding: () => fetchJson('/auth/onboarding'),
  updateOnboarding: (data: Record<string, unknown>) =>
    fetchJson('/auth/onboarding', { method: 'PATCH', body: JSON.stringify(data) }),
  forgotPassword: (email: string) =>
    fetchJson('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    fetchJson('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  changePassword: (current_password: string, new_password: string) =>
    fetchJson('/auth/password/change', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  requestAccountRecovery: (data: { email: string; reason: string; preferred_channel?: 'email' | 'whatsapp'; contact?: string }) =>
    fetchJson('/auth/recovery/request', { method: 'POST', body: JSON.stringify(data) }),
  completeAccountRecovery: (data: { case_id: string; token: string; password: string }) =>
    fetchJson('/auth/recovery/complete', { method: 'POST', body: JSON.stringify(data) }),
  getAdminAccountRecoveryCases: () => fetchJson('/admin/account-recovery'),
  approveAccountRecoveryCase: (caseId: string, notes = '') =>
    fetchJson(`/admin/account-recovery/${caseId}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
  rejectAccountRecoveryCase: (caseId: string, notes = '') =>
    fetchJson(`/admin/account-recovery/${caseId}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),

  // OTP
  sendOtp: (channel: string, contact: string) =>
    fetchJson('/auth/send-otp', { method: 'POST', body: JSON.stringify({ channel, contact }) }),
  verifyOtp: (contact: string, code: string) =>
    fetchJson('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ contact, code }) }),

  // Agencies
  searchAgencies: (q: string) => fetchJson(`/agencies/search?q=${encodeURIComponent(q)}`),
  applyToAgency: (agencyId: string, data: Record<string, string>) =>
    fetchJson('/agencies/apply', { method: 'POST', body: JSON.stringify({ agency_id: agencyId, ...data }) }),
  createAgency: (data: Record<string, unknown>) =>
    fetchJson('/agencies', { method: 'POST', body: JSON.stringify(data) }),
  getMyAgency: () => fetchJson('/agencies/my'),
  getAgency: (id: string) => fetchJson(`/agencies/${id}`),
  updateAgency: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/agencies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  inviteMember: (agencyId: string, data: Record<string, unknown>) =>
    fetchJson(`/agencies/${agencyId}/members`, { method: 'POST', body: JSON.stringify(data) }),
  updateMember: (agencyId: string, memberId: string, data: Record<string, unknown>) =>
    fetchJson(`/agencies/${agencyId}/members/${memberId}`, { method: 'PUT', body: JSON.stringify(data) }),
  removeMember: (agencyId: string, memberId: string) =>
    fetchJson(`/agencies/${agencyId}/members/${memberId}`, { method: 'DELETE' }),
  endAgencyMembership: (agencyId: string, memberId: string, data?: Record<string, unknown>) =>
    fetchJson(`/agencies/${agencyId}/members/${memberId}/end`, { method: 'POST', body: JSON.stringify(data || {}) }),
  getTiedListings: (agencyId: string, memberId: string) =>
    fetchJson(`/agencies/${agencyId}/members/${memberId}/tied-listings`),
  reassignAgencyListing: (agencyId: string, propertyId: string, data: Record<string, unknown>) =>
    fetchJson(`/agencies/${agencyId}/listings/${propertyId}/reassign`, { method: 'POST', body: JSON.stringify(data) }),

  // Properties
  getProperties: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/properties${qs}`)
  },
  getProperty: (id: string) => fetchJson(`/properties/${id}`),
  createProperty: (data: Record<string, unknown>) =>
    fetchJson('/properties', { method: 'POST', body: JSON.stringify(data) }),
  uploadMedia: async (files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    const token = localStorage.getItem('fi_token') || localStorage.getItem('sa_token')
    const res = await fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    const bodyText = await res.text()
    const parsed = (() => {
      try {
        return bodyText ? JSON.parse(bodyText) : null
      } catch {
        return null
      }
    })()
    if (!res.ok) {
      throw new Error(parsed?.error || `Upload failed (${res.status})`)
    }
    if (!parsed) {
      throw new Error('Upload endpoint returned a non-JSON response')
    }
    return parsed as { items: Array<{ url: string; media_type: 'image' | 'video'; filename: string }> }
  },
  updateProperty: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/properties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProperty: (id: string) =>
    fetchJson(`/properties/${id}`, { method: 'DELETE' }),

  // Agents
  getAgents: () => fetchJson('/agents'),
  getAgent: (id: string) => fetchJson(`/agents/${id}`),
  getAgentTransactions: (id: string) => fetchJson(`/agents/${id}/transactions`),
  getAgentReviews: (id: string) => fetchJson(`/agents/${id}/reviews`),
  createReview: (agentId: string, data: Record<string, unknown>) =>
    fetchJson(`/agents/${agentId}/reviews`, { method: 'POST', body: JSON.stringify(data) }),

  // Zillow-style features
  getPriceHistory: (id: string) => fetchJson(`/properties/${id}/price-history`),
  getComps: (id: string) => fetchJson(`/properties/${id}/comps`),
  getZestimate: (id: string) => fetchJson(`/properties/${id}/zestimate`),
  getNeighborhoodStats: (name: string) => fetchJson(`/neighborhoods/${name}/stats`),
  getNeighborhoods: () => fetchJson('/neighborhoods'),

  // Inquiries
  createInquiry: (data: Record<string, string>) =>
    fetchJson('/inquiries', { method: 'POST', body: JSON.stringify(data) }),
  getInquiries: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/inquiries${qs}`)
  },
  updateInquiry: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getInquiryTimeline: (id: string) => fetchJson(`/inquiries/${id}/timeline`),
  getViewings: () => fetchJson('/viewings'),
  createViewing: (data: Record<string, unknown>) =>
    fetchJson('/viewings', { method: 'POST', body: JSON.stringify(data) }),
  updateViewing: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/viewings/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Dashboard
  getDashboardStats: () => fetchJson('/dashboard/stats'),
  getDashboardAnalytics: () => fetchJson('/dashboard/analytics'),
  getDashboardOperations: () => fetchJson('/dashboard/operations'),
  getPropertyAnalytics: (id: string) => fetchJson(`/properties/${id}/analytics`),
  trackPropertyEvent: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/properties/${id}/events`, { method: 'POST', body: JSON.stringify(data) }),
  getListingNotes: (id: string) => fetchJson(`/properties/${id}/notes`),
  createListingNote: (id: string, data: { body: string; visibility?: string }) =>
    fetchJson(`/properties/${id}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  deleteListingNote: (id: string, noteId: string) =>
    fetchJson(`/properties/${id}/notes/${noteId}`, { method: 'DELETE' }),
  getListingReport: (id: string) => fetchJson(`/properties/${id}/report`),

  // Saved searches
  getSavedSearches: () => fetchJson('/saved-searches'),
  createSavedSearch: (name: string, filters: Record<string, unknown>) =>
    fetchJson('/saved-searches', {
      method: 'POST',
      body: JSON.stringify({
        name,
        filters,
        alert_enabled: true,
        alert_channel: 'inapp',
        alert_frequency: 'daily',
      }),
    }),
  createSavedSearchWithAlerts: (data: {
    name: string
    filters: Record<string, unknown>
    alert_enabled?: boolean
    alert_channel?: 'email' | 'whatsapp' | 'inapp'
    alert_frequency?: 'instant' | 'daily' | 'weekly'
  }) => fetchJson('/saved-searches', { method: 'POST', body: JSON.stringify(data) }),
  updateSavedSearch: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/saved-searches/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  runSavedSearchAlerts: () => fetchJson('/saved-searches/run-alerts', { method: 'POST', body: '{}' }),
  deleteSavedSearch: (id: string) =>
    fetchJson(`/saved-searches/${id}`, { method: 'DELETE' }),

  // Consumer automation / notifications
  getNotifications: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/notifications${qs}`)
  },
  markNotificationRead: (id: string) => fetchJson(`/notifications/${id}/read`, { method: 'POST', body: '{}' }),
  getNotificationPrefs: () => fetchJson('/notification-preferences'),
  updateNotificationPrefs: (data: Record<string, unknown>) =>
    fetchJson('/notification-preferences', { method: 'PATCH', body: JSON.stringify(data) }),
  runConsumerAutomation: (options?: { scope?: 'self' | 'all'; force_alerts?: boolean }) =>
    fetchJson('/automation/consumer/run', {
      method: 'POST',
      body: JSON.stringify({
        scope: options?.scope,
        force_alerts: options?.force_alerts,
      }),
    }),
  getConsumerAutomationMetrics: () => fetchJson('/automation/consumer/metrics'),
  getViewing: (id: string) => fetchJson(`/viewings/${id}`),
  retryNotification: (id: string) => fetchJson(`/notifications/${id}/retry`, { method: 'POST', body: '{}' }),
  getAdminNotificationDeadLetter: () => fetchJson('/admin/notifications/dead-letter'),
  retryAdminPendingNotifications: (limit = 20) =>
    fetchJson('/admin/notifications/retry-pending', { method: 'POST', body: JSON.stringify({ limit }) }),

  getActivityLog: () => fetchJson('/activity-log'),

  // Distribution Hub
  getPlatforms: () => fetchJson('/platforms'),
  getFiAccounts: () => fetchJson('/fi-accounts'),

  // Multi-tenant social channels
  getSocialChannelsConfig: (): Promise<{
    integration_models: Record<string, 'enterprise' | 'oauth'>
    connection_fields: Record<string, {
      model: 'enterprise' | 'oauth'
      target_fields: Array<{ key: string; label: string; required: boolean; secret: boolean }>
    }>
  }> => fetchJson('/social-channels/config'),
  getSocialChannels: (): Promise<Array<{
    id: string
    platform: string
    account_name: string
    status: string
    health: string
    handle: string | null
    enterprise_targets: Record<string, string>
    oauth: {
      connected: boolean
      scope?: string | null
      expires_at?: string | null
      user_id?: string | null
    }
    updated_at: string | null
  }>> => fetchJson('/social-channels'),
  upsertSocialChannel: (
    platform: string,
    payload: {
      handle?: string
      account_name?: string
      enterprise_targets?: Record<string, string>
    },
  ) => fetchJson(`/social-channels/${platform}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  }),
  disconnectSocialChannel: (platform: string) =>
    fetchJson(`/social-channels/${platform}`, { method: 'DELETE' }),
  startSocialOAuth: (platform: string): Promise<{ auth_url: string; state: string; dev: boolean }> =>
    fetchJson(`/social-channels/oauth/${platform}/start`),
  publishListingToSocial: (
    propertyId: string,
    payload: {
      channels: Array<{ platform: string; format?: string; link_url?: string }>
      caption: string
      media_urls?: string[]
    },
  ): Promise<{
    results: Array<{
      platform: string
      status: 'published' | 'failed'
      external_id: string | null
      external_url: string | null
      provider: string | null
      simulated: boolean
      error: string | null
    }>
  }> =>
    fetchJson(`/listings/${propertyId}/publish-social`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getMyConnections: () => fetchJson('/my-connections'),
  connectMyPlatform: (data: Record<string, unknown>) =>
    fetchJson('/my-connections', { method: 'POST', body: JSON.stringify(data) }),
  updateMyConnection: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/my-connections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  disconnectMyPlatform: (id: string) =>
    fetchJson(`/my-connections/${id}`, { method: 'DELETE' }),
  distributeOwn: (propertyId: string, platforms: string[], options?: {
    mode?: string
    formats?: Record<string, string[]>
    recipient?: string
    caption?: string
    intent?: string
  }) =>
    fetchJson(`/properties/${propertyId}/distribute-own`, {
      method: 'POST',
      body: JSON.stringify({
        platforms,
        mode: options?.mode || 'publish',
        formats: options?.formats,
        recipient: options?.recipient,
        caption: options?.caption,
        intent: options?.intent || 'distribute',
      }),
    }),
  getDistributions: (propertyId: string): Promise<Array<{
    id: string
    property_id: string
    platform: string
    status: string
    external_id: string | null
    published_at: string | null
    landing_page?: string | null
    post_url?: string | null
    insights?: {
      impressions: number | null
      reach: number | null
      likes: number | null
      comments: number | null
      shares: number | null
      saves: number | null
      clicks: number | null
      source: string
      simulated: boolean
      fetched_at: string
    } | null
    impressions?: number
    reach?: number
    likes?: number
    comments_count?: number
    shares?: number
    saves?: number
    clicks?: number
    insights_fetched_at?: string
  }>> => fetchJson(`/properties/${propertyId}/distributions`),
  refreshDistributionInsights: (distributionId: string) =>
    fetchJson(`/distributions/${distributionId}/refresh-insights`, { method: 'POST', body: '{}' }),
  retryDistribution: (distributionId: string) =>
    fetchJson(`/distributions/${distributionId}/retry`, { method: 'POST', body: '{}' }),
  retryPendingDistributions: (limit = 20) =>
    fetchJson('/distributions/retry-pending', { method: 'POST', body: JSON.stringify({ limit }) }),
  runRetryWorker: (options?: { limit?: number; due_only?: boolean; scope?: 'self' | 'all' }) =>
    fetchJson('/distributions/retry-worker/run', {
      method: 'POST',
      body: JSON.stringify({
        limit: options?.limit,
        due_only: options?.due_only,
        scope: options?.scope,
      }),
    }),

  // Contacts & Conversation Orchestrator
  getContacts: () => fetchJson('/contacts'),
  getContact: (id: string) => fetchJson(`/contacts/${id}`),
  updateContact: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  mergeContacts: (sourceId: string, targetContactId: string) =>
    fetchJson(`/contacts/${sourceId}/merge`, { method: 'POST', body: JSON.stringify({ target_contact_id: targetContactId }) }),
  getContactTimeline: (id: string) => fetchJson(`/contacts/${id}/timeline`),
  getContactNotes: (id: string) => fetchJson(`/contacts/${id}/notes`),
  createContactNote: (id: string, content: string) =>
    fetchJson(`/contacts/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),

  // Tasks
  getTasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/tasks${qs}`)
  },
  createTask: (data: Record<string, unknown>) => fetchJson('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  completeTask: (id: string) => fetchJson(`/tasks/${id}/complete`, { method: 'POST', body: '{}' }),
  deleteTask: (id: string) => fetchJson(`/tasks/${id}`, { method: 'DELETE' }),

  // Opportunities
  getOpportunities: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/opportunities${qs}`)
  },
  createOpportunity: (data: Record<string, unknown>) =>
    fetchJson('/opportunities', { method: 'POST', body: JSON.stringify(data) }),
  updateOpportunity: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getConversations: () => fetchJson('/conversations'),
  getConversation: (id: string) => fetchJson(`/conversations/${id}`),
  sendConversationMessage: (id: string, content: string, options?: { content_type?: string; image_url?: string; subject?: string }) =>
    fetchJson(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ content, ...(options || {}) }) }),

  getListingComments: (
    listingId: string,
    options?: { category?: string | string[] },
  ): Promise<{
    threads: Array<{
      conversation_id: string
      platform: string | null
      channel: string
      external_post_id: string | null
      distribution_url: string | null
      top_category: string | null
      contact: { id: string; name: string; avatar: string | null } | null
      messages: Array<{
        id: string
        direction: 'inbound' | 'outbound'
        content: string
        created_at: string
        author_name: string | null
        status: string
        category: string | null
        sentiment: 'positive' | 'neutral' | 'negative' | null
        category_confidence: number | null
        category_source: 'rules' | 'ai' | 'manual' | null
      }>
      last_activity_at: string | null
    }>
    published_posts: number
    summary: Record<string, number>
    category_meta: Record<string, { label: string; emoji: string; description: string; route: string }>
  }> => {
    const cat = options?.category
    const qs = cat
      ? '?category=' + encodeURIComponent(Array.isArray(cat) ? cat.join(',') : String(cat))
      : ''
    return fetchJson(`/listings/${listingId}/comments${qs}`)
  },
  getCommentClassifierConfig: (): Promise<{
    categories: string[]
    sentiments: string[]
    meta: Record<string, { label: string; emoji: string; description: string; route: string }>
  }> => fetchJson('/comment-classifier/config'),
  reclassifyComment: (messageId: string, category: string, sentiment?: string) =>
    fetchJson(`/comments/${messageId}/reclassify`, {
      method: 'POST',
      body: JSON.stringify({ category, sentiment }),
    }),
  backfillCommentCategories: (listingId: string) =>
    fetchJson(`/listings/${listingId}/comments/backfill-categories`, { method: 'POST', body: '{}' }),
  assignConversation: (id: string, agentId?: string) =>
    fetchJson(`/conversations/${id}/assign`, { method: 'POST', body: JSON.stringify({ agent_id: agentId }) }),
  updateConversation: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  closeConversation: (id: string, reason?: string) =>
    fetchJson(`/conversations/${id}/close`, { method: 'POST', body: JSON.stringify({ reason }) }),
  markConversationRead: (id: string) =>
    fetchJson(`/conversations/${id}/read`, { method: 'POST', body: '{}' }),

  // WhatsApp
  getWhatsAppStatus: () => fetchJson('/whatsapp/status'),
  sendWhatsAppListing: (propertyId: string, to?: string) =>
    fetchJson('/whatsapp/send-listing', { method: 'POST', body: JSON.stringify({ property_id: propertyId, to }) }),
  sendWhatsAppText: (to: string, message: string) =>
    fetchJson('/whatsapp/send-text', { method: 'POST', body: JSON.stringify({ to, message }) }),

  submitToFi: (propertyId: string, platforms: string[], message?: string) =>
    fetchJson(`/properties/${propertyId}/submit-to-fi`, { method: 'POST', body: JSON.stringify({ platforms, message }) }),
  getMySubmissions: () => fetchJson('/my-submissions'),
  getDistributionPerformance: () => fetchJson('/distribution/performance'),

  // Admin
  getAdminSubmissions: () => fetchJson('/admin/submissions'),
  approveSubmission: (id: string, notes?: string) =>
    fetchJson(`/admin/submissions/${id}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
  rejectSubmission: (id: string, notes?: string) =>
    fetchJson(`/admin/submissions/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),

  getSharePayload: (propertyId: string) => fetchJson(`/properties/${propertyId}/share`),
  getFeedUrl: () => `${API_BASE}/feed/properties.xml`,

  // Territories
  getTerritories: () => fetchJson('/territories'),
  getTerritoryDisclosureFields: (id: string) => fetchJson(`/territories/${id}/disclosure-fields`),
  createPropertyOffer: (propertyId: string, data: Record<string, unknown>) =>
    fetchJson(`/properties/${propertyId}/offers`, { method: 'POST', body: JSON.stringify(data) }),

  // Engagement
  getAgentEngagement: (id: string) => fetchJson(`/agents/${id}/engagement`),
  followAgent: (id: string) => fetchJson(`/agents/${id}/follow`, { method: 'POST', body: '{}' }),
  unfollowAgent: (id: string) => fetchJson(`/agents/${id}/follow`, { method: 'DELETE' }),
  getFollowingAgent: (id: string) => fetchJson(`/agents/${id}/following-me`),

  // White-label sites
  getTemplates: () => fetchJson('/white-label/templates'),
  createSite: (data: Record<string, unknown>) =>
    fetchJson('/white-label/sites', { method: 'POST', body: JSON.stringify(data) }),
  getSites: () => fetchJson('/white-label/sites'),
  getSite: (id: string) => fetchJson(`/white-label/sites/${id}`),
  updateSite: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/white-label/sites/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSite: (id: string) => fetchJson(`/white-label/sites/${id}`, { method: 'DELETE' }),

  // Domains
  createDomain: (data: Record<string, unknown>) =>
    fetchJson('/white-label/domains', { method: 'POST', body: JSON.stringify(data) }),
  getDomains: () => fetchJson('/white-label/domains'),

  // Routing rules
  createRoutingRule: (data: Record<string, unknown>) =>
    fetchJson('/white-label/routing-rules', { method: 'POST', body: JSON.stringify(data) }),
  getRoutingRules: () => fetchJson('/white-label/routing-rules'),
  updateRoutingRule: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/white-label/routing-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoutingRule: (id: string) => fetchJson(`/white-label/routing-rules/${id}`, { method: 'DELETE' }),

  // Sync connections
  createSyncConnection: (data: Record<string, unknown>) =>
    fetchJson('/white-label/sync-connections', { method: 'POST', body: JSON.stringify(data) }),
  getSyncConnections: () => fetchJson('/white-label/sync-connections'),
  deleteSyncConnection: (id: string) => fetchJson(`/white-label/sync-connections/${id}`, { method: 'DELETE' }),
  runSyncConnection: (id: string, body?: Record<string, unknown>) =>
    fetchJson(`/white-label/sync-connections/${id}/run`, { method: 'POST', body: JSON.stringify(body || {}) }),
  importListings: (listings: unknown[], source?: string) =>
    fetchJson('/white-label/import-listings', { method: 'POST', body: JSON.stringify({ listings, source }) }),

  // Widgets
  createWidget: (data: Record<string, unknown>) =>
    fetchJson('/white-label/widgets', { method: 'POST', body: JSON.stringify(data) }),
  getWidgets: () => fetchJson('/white-label/widgets'),
  deleteWidget: (id: string) => fetchJson(`/white-label/widgets/${id}`, { method: 'DELETE' }),

  // Message Templates
  getMessageTemplates: (params?: { channel?: string; category?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/message-templates${qs}`)
  },
  getDefaultMessageTemplates: (params?: { channel?: string; category?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/message-templates/defaults${qs}`)
  },
  getMessageTemplate: (id: string) => fetchJson(`/message-templates/${id}`),
  createMessageTemplate: (data: Record<string, unknown>) =>
    fetchJson('/message-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateMessageTemplate: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/message-templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMessageTemplate: (id: string) => fetchJson(`/message-templates/${id}`, { method: 'DELETE' }),
  renderMessageTemplate: (id: string, variables: Record<string, string>) =>
    fetchJson(`/message-templates/${id}/render`, { method: 'POST', body: JSON.stringify({ variables }) }),

  // Analytics
  getCrmAnalytics: (params?: { start_date?: string; end_date?: string; scope?: 'all'; agency_id?: string }) =>
    fetchJson(`/analytics/crm${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  getCommunicationsAnalytics: (params?: { start_date?: string; end_date?: string; scope?: 'all'; agency_id?: string }) =>
    fetchJson(`/analytics/communications${params ? '?' + new URLSearchParams(params).toString() : ''}`),
  trackEvent: (data: Record<string, unknown>) =>
    fetchJson('/white-label/analytics', { method: 'POST', body: JSON.stringify(data) }),
  getAnalytics: () => fetchJson('/white-label/analytics'),

  // Public pages
  getPublicAgency: (id: string) => fetchJson(`/public/agencies/${id}`),
  getPublicAgentPortfolio: (id: string) => fetchJson(`/public/agents/${id}/portfolio`),
  getPublicSiteBySubdomain: (subdomain: string) => fetchJson(`/public/sites/by-subdomain/${subdomain}`),
  getPublicSiteProperty: (subdomain: string, propertyId: string) =>
    fetchJson(`/public/sites/by-subdomain/${subdomain}/properties/${propertyId}`),
  trackPublicSiteEvent: (subdomain: string, data: Record<string, unknown>) =>
    fetchJson(`/public/sites/by-subdomain/${subdomain}/events`, { method: 'POST', body: JSON.stringify(data) }),

  // Campaigns / Drip sequences
  getCampaigns: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/campaigns${qs}`)
  },
  getCampaign: (id: string) => fetchJson(`/campaigns/${id}`),
  createCampaign: (data: Record<string, unknown>) =>
    fetchJson('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCampaign: (id: string) => fetchJson(`/campaigns/${id}`, { method: 'DELETE' }),
  enrollContactInCampaign: (id: string, contactId: string) =>
    fetchJson(`/campaigns/${id}/enroll`, { method: 'POST', body: JSON.stringify({ contact_id: contactId }) }),
  autoEnrollCampaign: (id: string, maxContacts?: number) =>
    fetchJson(`/campaigns/${id}/auto-enroll`, { method: 'POST', body: JSON.stringify({ max_contacts: maxContacts }) }),
  getCampaignEnrollments: (id: string) => fetchJson(`/campaigns/${id}/enrollments`),
  getEnrollments: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/enrollments${qs}`)
  },
  getEnrollment: (id: string) => fetchJson(`/enrollments/${id}`),
  updateEnrollment: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/enrollments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  runCampaignScheduler: (limit?: number) =>
    fetchJson('/campaigns/run-scheduler', { method: 'POST', body: JSON.stringify({ limit }) }),

  // GDPR / data subject rights
  deleteContact: (id: string) => fetchJson(`/contacts/${id}`, { method: 'DELETE' }),
  exportContact: (id: string) =>
    fetchJson(`/contacts/${id}/export`, { headers: { Accept: 'application/json' } }),

  // Property CTAs
  getPropertyCtaConfig: (id: string) => fetchJson(`/properties/${id}/cta-config`),
  updateAgentCtaConfig: (config: Record<string, unknown>) =>
    fetchJson('/auth/me', { method: 'PUT', body: JSON.stringify({ cta_config: config }) }),
  updateAgencyCtaConfig: (id: string, config: Record<string, unknown>) =>
    fetchJson(`/agencies/${id}`, { method: 'PUT', body: JSON.stringify({ cta_config: config }) }),
  scheduleCall: (data: Record<string, unknown>) => fetchJson('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  bookViewing: (data: Record<string, unknown>) => fetchJson('/viewings', { method: 'POST', body: JSON.stringify(data) }),

  // WhatsApp Listings Module
  getWhatsAppListingsHealth: () => fetchJson('/admin/whatsapp-listings/health'),
  getWhatsAppListingsDrafts: () => fetchJson('/agent/whatsapp-listings/drafts'),
  getWhatsAppListingsDraft: (id: string) => fetchJson(`/agent/whatsapp-listings/drafts/${id}`),
  approveWhatsAppListingsDraft: (id: string, publishSocial = false) =>
    fetchJson(`/agent/whatsapp-listings/drafts/${id}/approve`, { method: 'POST', body: JSON.stringify({ publish_social: publishSocial }) }),
  discardWhatsAppListingsDraft: (id: string) =>
    fetchJson(`/agent/whatsapp-listings/drafts/${id}/discard`, { method: 'POST', body: '{}' }),
  reprocessWhatsAppListingsDraft: (id: string) =>
    fetchJson(`/agent/whatsapp-listings/drafts/${id}/reprocess`, { method: 'POST', body: '{}' }),
  getWhatsAppListingsAgentSettings: () => fetchJson('/agent/whatsapp-listings/settings'),
  updateWhatsAppListingsAgentSettings: (data: Record<string, unknown>) =>
    fetchJson('/agent/whatsapp-listings/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  getWhatsAppListingsAgentAnalytics: () => fetchJson('/agent/whatsapp-listings/analytics'),
  getWhatsAppListingsAgentCredits: () => fetchJson('/agent/credits/balance'),
  getWhatsAppListingsAgentTransactions: (limit = 100) =>
    fetchJson(`/agent/credits/transactions?limit=${limit}`),
  topUpWhatsAppListingsAgentCredits: (amountUsd: number, paymentIntentId?: string) =>
    fetchJson('/agent/credits/top-up', { method: 'POST', body: JSON.stringify({ amount_usd: amountUsd, stripe_payment_intent_id: paymentIntentId }) }),

  getAdminWhatsAppListingsUsage: () => fetchJson('/admin/whatsapp-listings/usage'),
  getAdminWhatsAppListingsAuditLog: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/whatsapp-listings/audit-log${qs}`)
  },
  getAdminWhatsAppListingsEntitlements: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/entitlements${qs}`)
  },
  createAdminWhatsAppListingsEntitlement: (data: Record<string, unknown>) =>
    fetchJson('/admin/entitlements', { method: 'POST', body: JSON.stringify(data) }),
  deleteAdminWhatsAppListingsEntitlement: (id: string) =>
    fetchJson(`/admin/entitlements/${id}`, { method: 'DELETE' }),

  getAgencyWhatsAppListingsUsage: () => fetchJson('/agency/whatsapp-listings/usage'),
  getAgencyWhatsAppListingsEntitlements: () => fetchJson('/agency/entitlements'),
  createAgencyWhatsAppListingsEntitlement: (data: Record<string, unknown>) =>
    fetchJson('/agency/entitlements', { method: 'POST', body: JSON.stringify(data) }),
  updateAgencyWhatsAppListingsEntitlement: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/agency/entitlements/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getAgencyWhatsAppListingsCredits: () => fetchJson('/agency/credits/balance'),
  getAgencyWhatsAppListingsTransactions: (limit = 100) =>
    fetchJson(`/agency/credits/transactions?limit=${limit}`),
  topUpAgencyWhatsAppListingsCredits: (amountUsd: number, paymentIntentId?: string) =>
    fetchJson('/agency/credits/top-up', { method: 'POST', body: JSON.stringify({ amount_usd: amountUsd, stripe_payment_intent_id: paymentIntentId }) }),
  allocateAgencyWhatsAppListingsCredits: (agentId: string, amountUsd: number) =>
    fetchJson('/agency/credits/allocate', { method: 'POST', body: JSON.stringify({ agent_id: agentId, amount_usd: amountUsd }) }),

  // Reminder policies
  getReminderPolicies: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/reminder-policies${qs}`)
  },
  createReminderPolicy: (data: Record<string, unknown>) =>
    fetchJson('/reminder-policies', { method: 'POST', body: JSON.stringify(data) }),
  updateReminderPolicy: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/reminder-policies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReminderPolicy: (id: string) => fetchJson(`/reminder-policies/${id}`, { method: 'DELETE' }),

  // Admin audit log
  getAdminAuditLog: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/audit-log${qs}`)
  },
  runAuditLogRetention: () => fetchJson('/admin/audit-log/retention', { method: 'POST', body: '{}' }),
  promoteUser: (id: string, role: 'platform_admin' | null) =>
    fetchJson(`/admin/users/${id}/promote`, { method: 'POST', body: JSON.stringify({ role }) }),

  // Area Intelligence (public)
  listAreas: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/areas${qs}`)
  },
  getArea: (slug: string) => fetchJson(`/areas/${slug}`),
  getAreaScores: (slug: string) => fetchJson(`/areas/${slug}/scores`),
  getAreaGoogleScores: (slug: string) => fetchJson(`/areas/${slug}/google-scores`),
  getAreaProperties: (slug: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/areas/${slug}/properties${qs}`)
  },
  compareAreas: (slug: string, withSlug: string) =>
    fetchJson(`/areas/${slug}/comparison?with=${encodeURIComponent(withSlug)}`),

  // Area Intelligence (inspector)
  getInspectorAssignments: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/inspector/assignments${qs}`)
  },
  startInspectorAssignment: (id: string) =>
    fetchJson(`/inspector/assignments/${id}/start`, { method: 'POST', body: '{}' }),
  getInspectorSubmissions: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/inspector/submissions${qs}`)
  },
  createInspectorSubmission: (data: Record<string, unknown>) =>
    fetchJson('/inspector/submissions', { method: 'POST', body: JSON.stringify(data) }),

  // Area Intelligence (admin)
  listAdminAreas: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/areas${qs}`)
  },
  createAdminArea: (data: Record<string, unknown>) =>
    fetchJson('/admin/areas', { method: 'POST', body: JSON.stringify(data) }),
  getAdminArea: (id: string) => fetchJson(`/admin/areas/${id}`),
  updateAdminArea: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/areas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminArea: (id: string) => fetchJson(`/admin/areas/${id}`, { method: 'DELETE' }),
  enableAreaScoring: (id: string) =>
    fetchJson(`/admin/areas/${id}/enable-scoring`, { method: 'POST', body: '{}' }),
  disableAreaScoring: (id: string) =>
    fetchJson(`/admin/areas/${id}/disable-scoring`, { method: 'POST', body: '{}' }),
  listAdminDimensions: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/scoring/dimensions${qs}`)
  },
  createAdminDimension: (data: Record<string, unknown>) =>
    fetchJson('/admin/scoring/dimensions', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminDimension: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/scoring/dimensions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminDimension: (id: string) =>
    fetchJson(`/admin/scoring/dimensions/${id}`, { method: 'DELETE' }),
  listAdminSourceTypes: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/scoring/source-types${qs}`)
  },
  createAdminSourceType: (data: Record<string, unknown>) =>
    fetchJson('/admin/scoring/source-types', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminSourceType: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/scoring/source-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminSourceType: (id: string) =>
    fetchJson(`/admin/scoring/source-types/${id}`, { method: 'DELETE' }),
  listAdminAiConfigs: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/scoring/ai-configs${qs}`)
  },
  createAdminAiConfig: (data: Record<string, unknown>) =>
    fetchJson('/admin/scoring/ai-configs', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminAiConfig: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/scoring/ai-configs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminAiConfig: (id: string) =>
    fetchJson(`/admin/scoring/ai-configs/${id}`, { method: 'DELETE' }),
  listAdminSignals: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/scoring/signals${qs}`)
  },
  verifyAdminSignal: (id: string, notes?: string) =>
    fetchJson(`/admin/scoring/signals/${id}/verify`, { method: 'POST', body: JSON.stringify({ notes }) }),
  rejectAdminSignal: (id: string, reason?: string) =>
    fetchJson(`/admin/scoring/signals/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  calculateAdminScores: (areaId: string) =>
    fetchJson('/admin/scoring/calculate', { method: 'POST', body: JSON.stringify({ area_id: areaId }) }),
  overrideAdminScore: (data: Record<string, unknown>) =>
    fetchJson('/admin/scoring/override', { method: 'POST', body: JSON.stringify(data) }),
  getAdminGoogleUsage: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/google-usage${qs}`)
  },

  // Market Pricing (public)
  getPricingAnalysis: (propertyId: string, params?: Record<string, string>): Promise<PricingAnalysis> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/pricing/analysis/${propertyId}${qs}`)
  },
  getPricingComparables: (propertyId: string): Promise<Record<string, unknown>[]> => fetchJson(`/pricing/comparables/${propertyId}`),
  getPricingTrends: (areaId: string, propertyType: string): Promise<PricingTrendSnapshot[]> =>
    fetchJson(`/pricing/trends/${areaId}?property_type=${encodeURIComponent(propertyType)}`),
  reportComparable: (data: Record<string, unknown>) =>
    fetchJson('/pricing/report-comparable', { method: 'POST', body: JSON.stringify(data) }),
  getMyComparableReports: () => fetchJson('/pricing/my-comparable-reports'),
  getMyAgentPriceReports: (): Promise<AgentPriceReport[]> => fetchJson('/pricing/my-agent-price-reports'),
  getAgentPricingPortfolio: (): Promise<AgentPricingPortfolio> => fetchJson('/agent/pricing/portfolio'),
  getAgencyPricingPortfolio: (): Promise<AgencyPricingPortfolio> => fetchJson('/agency/pricing/portfolio'),
  keepAgentListingPrice: (propertyId: string, reason?: string): Promise<PricingDecision> =>
    fetchJson(`/agent/pricing/properties/${propertyId}/keep-price`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adjustAgentListingPrice: (propertyId: string, newPrice: number, reason?: string) =>
    fetchJson(`/agent/pricing/properties/${propertyId}/adjust-price`, { method: 'POST', body: JSON.stringify({ new_price: newPrice, reason }) }),

  // Market Pricing (admin)
  getAdminPricingConfigs: () => fetchJson('/admin/pricing/configs'),
  createAdminPricingConfig: (data: Record<string, unknown>) =>
    fetchJson('/admin/pricing/configs', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminPricingConfig: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/pricing/configs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminPricingConfig: (id: string) =>
    fetchJson(`/admin/pricing/configs/${id}`, { method: 'DELETE' }),

  getAdminPricingSources: () => fetchJson('/admin/pricing/sources'),
  createAdminPricingSource: (data: Record<string, unknown>) =>
    fetchJson('/admin/pricing/sources', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminPricingSource: (source: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/pricing/sources/${source}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminPricingSource: (source: string) =>
    fetchJson(`/admin/pricing/sources/${source}`, { method: 'DELETE' }),

  getAdminPricingCurrencyRates: () => fetchJson('/admin/pricing/currency-rates'),
  createAdminPricingCurrencyRate: (data: Record<string, unknown>) =>
    fetchJson('/admin/pricing/currency-rates', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminPricingCurrencyRate: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/pricing/currency-rates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminPricingCurrencyRate: (id: string) =>
    fetchJson(`/admin/pricing/currency-rates/${id}`, { method: 'DELETE' }),
  refreshAdminPricingCurrencyRates: () =>
    fetchJson('/admin/pricing/currency-rates/refresh', { method: 'POST', body: '{}' }),

  importAdminPricingCsv: (csvText: string, filename?: string) =>
    fetchJson('/admin/pricing/external-comparables/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csv_text: csvText, filename }),
    }),
  getAdminPricingCsvImportLogs: () => fetchJson('/admin/pricing/csv-import-logs'),

  getAdminPricingNormalizationRules: () => fetchJson('/admin/pricing/normalization-rules'),
  createAdminPricingNormalizationRule: (data: Record<string, unknown>) =>
    fetchJson('/admin/pricing/normalization-rules', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminPricingNormalizationRule: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/pricing/normalization-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAdminPricingNormalizationRule: (id: string) =>
    fetchJson(`/admin/pricing/normalization-rules/${id}`, { method: 'DELETE' }),

  recalculateAdminPricing: (data: Record<string, unknown>) =>
    fetchJson('/admin/pricing/recalculate', { method: 'POST', body: JSON.stringify(data) }),
  createAdminPricingRecalculationJob: (data: Record<string, unknown>): Promise<PricingRecalculationJob> =>
    fetchJson('/admin/pricing/recalculation-jobs', { method: 'POST', body: JSON.stringify(data) }),
  getAdminPricingRecalculationJobs: (params?: Record<string, string>): Promise<PricingRecalculationJob[]> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return fetchJson(`/admin/pricing/recalculation-jobs${qs}`)
  },
  getAdminPricingRecalculationJob: (id: string, includeItems = false) =>
    fetchJson(`/admin/pricing/recalculation-jobs/${id}?include_items=${includeItems}`),
  cancelAdminPricingRecalculationJob: (id: string): Promise<PricingRecalculationJob> =>
    fetchJson(`/admin/pricing/recalculation-jobs/${id}/cancel`, { method: 'POST', body: '{}' }),
  retryAdminPricingRecalculationJob: (id: string): Promise<PricingRecalculationJob> =>
    fetchJson(`/admin/pricing/recalculation-jobs/${id}/retry-failed`, { method: 'POST', body: '{}' }),

  getAdminPricingTrends: () => fetchJson('/admin/pricing/trends'),
  runAdminPricingTrends: () => fetchJson('/admin/pricing/trends/run', { method: 'POST', body: '{}' }),

  getAdminPricingReports: () => fetchJson('/admin/pricing/reports'),
  reviewAdminPricingReport: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/pricing/reports/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),

  getAdminAgentPriceReports: () => fetchJson('/admin/pricing/agent-price-reports'),
  reviewAdminAgentPriceReport: (id: string, data: Record<string, unknown>) =>
    fetchJson(`/admin/pricing/agent-price-reports/${id}/review`, { method: 'POST', body: JSON.stringify(data) }),

  submitAgentPriceReport: (data: Record<string, unknown>) =>
    fetchJson('/pricing/agent-price-reports', { method: 'POST', body: JSON.stringify(data) }),

  // Listings AI — draft a listing from photos.
  describeListingFromPhotos: (payload: {
    photo_urls: string[]
    hints?: {
      city?: string
      neighborhood?: string
      type?: 'sale' | 'rent'
      property_type?: string
      price?: number
      currency?: string
      notes?: string
    }
    provider?: string
    intent?: 'create' | 'update'
    existing_listing?: Record<string, unknown>
  }): Promise<{
    property: {
      title: string | null
      description: string | null
      type: 'sale' | 'rent' | null
      property_type: string | null
      price: number | null
      price_unit: string | null
      bedrooms: number | null
      bathrooms: number | null
      area: number | null
      area_unit: string | null
      location: string | null
      city: string | null
      neighborhood: string | null
      address: string | null
      amenities: string[]
      furnished: boolean | null
      features: string[]
      confidence: number
    }
    provider: string
    change_summary: Record<string, unknown> | null
  }> => fetchJson('/listings-ai/describe', { method: 'POST', body: JSON.stringify(payload) }),
}
