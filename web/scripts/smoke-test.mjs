#!/usr/bin/env node
import process from 'node:process'

const port = process.env.PORT || '3001'
const baseUrl = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${port}`
const endpoints = ['/api/health', '/api/ready']

async function requestJson(path, options = {}) {
  const mergedHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: mergedHeaders,
  })

  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status} ${JSON.stringify(payload)}`)
  }

  return payload
}

async function requestJsonExpectError(path, options = {}) {
  const mergedHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: mergedHeaders,
  })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (response.ok) {
    throw new Error(`${path} was expected to fail but returned ${response.status}`)
  }
  return { status: response.status, payload }
}

async function main() {
  for (const endpoint of endpoints) {
    const payload = await requestJson(endpoint)
    console.log(`[smoke] ${endpoint} -> ${JSON.stringify(payload)}`)
  }

  const now = Date.now()
  const email = `smoke.${now}@example.com`
  const password = 'smoke-pass-123'
  let adminToken = null
  const registerBody = {
    name: `Smoke Agent ${now}`,
    email,
    phone: '+96170000000',
    password,
    license_number: `SMK-${now}`,
    agency_name: 'Smoke Agency',
    agency_license: `AG-${now}`,
    specialization: 'Residential',
    languages: 'en,ar',
    bio: 'Smoke test account',
    office_address: 'Smoke Street, Beirut',
    agency_mode: 'none',
    territories: ['Beirut'],
    property_types: ['Apartment'],
    otp_verified: true,
    terms_accepted: true,
  }

  const register = await requestJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(registerBody),
  })
  if (!register?.token || !register?.agent?.id) {
    throw new Error('/api/auth/register did not return token and agent')
  }
  console.log(`[smoke] /api/auth/register -> agent ${register.agent.id}`)

  const login = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!login?.token || !login?.agent?.id) {
    throw new Error('/api/auth/login did not return token and agent')
  }
  console.log(`[smoke] /api/auth/login -> agent ${login.agent.id}`)

  const me = await requestJson('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${login.token}`,
    },
  })
  if (me?.email !== email) {
    throw new Error('/api/auth/me returned unexpected user')
  }
  console.log(`[smoke] /api/auth/me -> ${me.email}`)

  const forgot = await requestJson('/api/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  if (!forgot?.success) {
    throw new Error('/api/auth/password/forgot failed to return success')
  }
  const resetToken = forgot?._dev_reset_token
  if (!resetToken) {
    throw new Error('Expected _dev_reset_token in non-production smoke run')
  }
  const resetPassword = 'smoke-pass-456'
  const reset = await requestJson('/api/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: resetPassword }),
  })
  if (!reset?.success) {
    throw new Error('/api/auth/password/reset failed')
  }
  console.log('[smoke] password reset flow completed')

  const oldLoginExpectedFail = await requestJsonExpectError('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (oldLoginExpectedFail.status !== 401) {
    throw new Error(`Expected old password login to fail with 401, got ${oldLoginExpectedFail.status}`)
  }

  const loginAfterReset = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: resetPassword }),
  })
  if (!loginAfterReset?.token) {
    throw new Error('Expected login with reset password to succeed')
  }

  const changedPassword = 'smoke-pass-789'
  const changed = await requestJson('/api/auth/password/change', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterReset.token}`,
    },
    body: JSON.stringify({ current_password: resetPassword, new_password: changedPassword }),
  })
  if (!changed?.success || !changed?.token) {
    throw new Error('/api/auth/password/change did not return success and new token')
  }
  console.log('[smoke] password change flow completed')

  const loginAfterChange = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: changedPassword }),
  })
  if (!loginAfterChange?.token) {
    throw new Error('Expected login with changed password to succeed')
  }

  const recoveryRequest = await requestJson('/api/auth/recovery/request', {
    method: 'POST',
    body: JSON.stringify({
      email,
      reason: 'Lost device and cannot access email OTP. Please assist with account recovery.',
      preferred_channel: 'email',
      contact: email,
    }),
  })
  if (!recoveryRequest?.success) {
    throw new Error('/api/auth/recovery/request did not return success')
  }
  console.log('[smoke] account recovery request flow completed')

  const adminEmail = process.env.SMOKE_ADMIN_EMAIL || process.env.ADMIN_EMAIL
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD
  if (adminEmail && adminPassword) {
    const adminLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    })
    if (!adminLogin?.token) {
      throw new Error('Admin login failed for account recovery approval flow')
    }
    adminToken = adminLogin.token
    const caseId = recoveryRequest?._dev_case_id
    if (!caseId) {
      throw new Error('Expected _dev_case_id for account recovery request in non-production mode')
    }
    const approved = await requestJson(`/api/admin/account-recovery/${caseId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminLogin.token}`,
      },
      body: JSON.stringify({ notes: 'Smoke test approval' }),
    })
    const recoveryToken = approved?._dev_recovery_token
    if (!recoveryToken) {
      throw new Error('Expected _dev_recovery_token from admin approval in non-production mode')
    }
    const recoveredPassword = 'smoke-pass-987'
    const completed = await requestJson('/api/auth/recovery/complete', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, token: recoveryToken, password: recoveredPassword }),
    })
    if (!completed?.success) {
      throw new Error('/api/auth/recovery/complete did not return success')
    }
    const postRecoveryLogin = await requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: recoveredPassword }),
    })
    if (!postRecoveryLogin?.token) {
      throw new Error('Expected post-recovery login to succeed')
    }
    console.log('[smoke] account recovery approval + completion flow completed')
  } else {
    console.log('[smoke] admin credentials not provided; skipped account recovery approval/completion sub-flow')
  }

  const onboarding = await requestJson('/api/auth/onboarding', {
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
  })
  if (!onboarding?.onboarding_stage || !onboarding?.onboarding_status) {
    throw new Error('/api/auth/onboarding did not return onboarding fields')
  }
  console.log(`[smoke] /api/auth/onboarding -> ${onboarding.onboarding_stage} / ${onboarding.onboarding_status}`)

  const onboardingPatch = await requestJson('/api/auth/onboarding', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      onboarding_stage: 'activation_review',
      onboarding_status: 'pending_activation',
      onboarding_steps: {
        contact_verified: true,
        profile_completed: true,
        terms_accepted: true,
      },
    }),
  })
  if (onboardingPatch?.onboarding_status !== 'pending_activation') {
    throw new Error('/api/auth/onboarding PATCH did not update status as expected')
  }
  console.log('[smoke] /api/auth/onboarding PATCH -> pending_activation')

  const properties = await requestJson('/api/properties')
  if (!Array.isArray(properties)) {
    throw new Error('/api/properties did not return an array')
  }
  console.log(`[smoke] /api/properties -> ${properties.length} listing(s)`)

  const property = await requestJson('/api/properties', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      title: `Smoke Listing ${now}`,
      description: 'Smoke listing for distribution validation',
      type: 'sale',
      property_type: 'apartment',
      price: 250000,
      city: 'Beirut',
      location: 'Beirut',
      classification: 'apartment',
      permissible_buildup_area: 120,
    }),
  })
  if (!property?.id) {
    throw new Error('Failed to create smoke property for distribution checks')
  }
  console.log(`[smoke] created property ${property.id}`)

  // ==================== PROPERTY CTA CONFIG ====================
  const ctaConfig = await requestJson(`/api/properties/${property.id}/cta-config`)
  if (!ctaConfig?.cta_config?.contact?.enabled) {
    throw new Error('Expected property CTA config to expose enabled contact button')
  }
  if (!ctaConfig?.cta_config?.schedule_call?.enabled || !ctaConfig?.cta_config?.book_viewing?.enabled) {
    throw new Error('Expected property CTA config to expose schedule_call and book_viewing buttons')
  }
  if (!ctaConfig?.agent_id || !ctaConfig?.agent_name) {
    throw new Error('Expected property CTA config to include listing agent')
  }
  console.log('[smoke] property CTA config returned expected shape')

  // ==================== AGENT/AGENCY CTA CUSTOMIZATION ====================
  const customCta = {
    contact: { enabled: true, channels: ['email', 'whatsapp'], mode: 'platform_routed' },
    schedule_call: { enabled: true, channels: ['phone'] },
    book_viewing: { enabled: true, channels: ['email', 'whatsapp'] },
    more_from_agent: { enabled: true, label: 'Browse listings by this agent' },
    more_from_agency: { enabled: true, label: 'Browse all agency listings' },
  }
  const ctaUpdate = await requestJson('/api/auth/me', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ cta_config: customCta }),
  })
  if (ctaUpdate?.cta_config?.contact?.mode !== 'platform_routed') {
    throw new Error('Expected agent CTA config update to persist platform_routed mode')
  }
  const ctaConfigAfterUpdate = await requestJson(`/api/properties/${property.id}/cta-config`)
  if (ctaConfigAfterUpdate?.cta_config?.contact?.mode !== 'platform_routed') {
    throw new Error('Expected public CTA config to reflect agent-level customization')
  }
  console.log('[smoke] agent CTA customization persisted and reflected on property page')

  const inquiry = await requestJson('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      property_id: property.id,
      property_title: property.title,
      name: 'Smoke Buyer',
      email: `buyer.${now}@example.com`,
      phone: `+96171${String(now).slice(-6)}`,
      message: 'I want to visit this property this week.',
      source: 'marketplace',
      channel: 'web',
    }),
  })
  if (!inquiry?.id) {
    throw new Error('Expected inquiry creation to return an id')
  }
  console.log('[smoke] inquiry created')

  const inquiryPatched = await requestJson(`/api/inquiries/${inquiry.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      status: 'contacted',
      stage: 'first_response',
      priority: 'high',
    }),
  })
  if (inquiryPatched?.status !== 'contacted' || inquiryPatched?.priority !== 'high') {
    throw new Error('Expected inquiry patch to apply status/priority')
  }

  // ==================== PLATFORM-ROUTED INQUIRY ====================
  const routedInquiry = await requestJson('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      property_id: property.id,
      property_title: property.title,
      name: 'Smoke Routed Buyer',
      email: `routed.${now}@example.com`,
      phone: `+96179${String(now).slice(-6)}`,
      message: 'I want to inquire through the platform.',
      source: 'marketplace',
      channel: 'web',
      contact_mode: 'platform_routed',
    }),
  })
  if (!routedInquiry?.id) {
    throw new Error('Expected platform-routed inquiry to be created')
  }
  if (routedInquiry.contact_mode !== 'platform_routed') {
    throw new Error('Expected platform-routed inquiry to record contact_mode')
  }
  if (!routedInquiry.contact_id) {
    throw new Error('Expected platform-routed inquiry to create a contact')
  }
  const routedTasks = await requestJson('/api/tasks', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!routedTasks.items.some((t) => t.inquiry_id === routedInquiry.id && t.type === 'follow_up')) {
    throw new Error('Expected platform-routed inquiry to generate a follow-up task for the agent')
  }
  const routedConversations = await requestJson('/api/conversations', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!routedConversations.some((c) => c.contact_id === routedInquiry.contact_id)) {
    throw new Error('Expected platform-routed inquiry to start a conversation with the lead')
  }
  console.log('[smoke] platform-routed inquiry created task and conversation')

  const viewing = await requestJson('/api/viewings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      inquiry_id: inquiry.id,
      property_id: property.id,
      scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      mode: 'in_person',
      location: 'Property entrance',
      notes: 'Smoke scheduled viewing',
    }),
  })
  if (!viewing?.id || viewing?.status !== 'scheduled') {
    throw new Error('Expected viewing schedule endpoint to return scheduled viewing')
  }
  console.log('[smoke] viewing scheduled')

  // Viewing depth: reschedule with client notification metadata
  const rescheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const rescheduled = await requestJson(`/api/viewings/${viewing.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      scheduled_at: rescheduledAt,
      notify_client: true,
      notify_channel: 'email',
    }),
  })
  if (rescheduled.status !== 'scheduled' || rescheduled.scheduled_at !== rescheduledAt) {
    throw new Error('Expected viewing reschedule to update scheduled_at')
  }
  if (!rescheduled.client_notified || rescheduled.client_notified.channel !== 'email') {
    throw new Error('Expected reschedule with notify_client to record client_notified metadata')
  }
  console.log('[smoke] viewing rescheduled with client notification metadata')

  // Cancel viewing and verify follow-up generation
  const cancelled = await requestJson(`/api/viewings/${viewing.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      status: 'cancelled',
      notify_client: true,
      notify_channel: 'whatsapp',
      outcome_notes: 'Client requested cancellation',
    }),
  })
  if (cancelled.status !== 'cancelled') {
    throw new Error('Expected viewing status to be cancelled')
  }
  if (!cancelled.client_notified || cancelled.client_notified.channel !== 'whatsapp') {
    throw new Error('Expected cancelled viewing to record client_notified metadata')
  }
  const inquiryAfterCancel = await requestJson(`/api/inquiries/${inquiry.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!inquiryAfterCancel.next_follow_up_at) {
    throw new Error('Expected cancellation to generate inquiry follow-up')
  }
  console.log('[smoke] viewing cancelled and inquiry follow-up generated')

  // Completed viewing with interested outcome
  const viewing2 = await requestJson('/api/viewings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      inquiry_id: inquiry.id,
      property_id: property.id,
      scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      mode: 'virtual',
      location: 'Zoom link',
      notes: 'Smoke completed viewing',
    }),
  })
  if (!viewing2?.id) {
    throw new Error('Expected second viewing to be created')
  }
  const completed = await requestJson(`/api/viewings/${viewing2.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      status: 'completed',
      outcome: 'interested',
      outcome_notes: 'Client loved the place',
    }),
  })
  if (completed.status !== 'completed' || completed.outcome !== 'interested') {
    throw new Error('Expected completed viewing with interested outcome')
  }
  const inquiryAfterComplete = await requestJson(`/api/inquiries/${inquiry.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (inquiryAfterComplete.stage !== 'offer') {
    throw new Error(`Expected inquiry stage to advance to offer after interested viewing, got ${inquiryAfterComplete.stage}`)
  }
  const completedFollowUpMs = new Date(inquiryAfterComplete.next_follow_up_at).getTime()
  const expectedCompletedFollowUpMs = Date.now() + 60 * 60 * 1000
  if (Math.abs(completedFollowUpMs - expectedCompletedFollowUpMs) > 5 * 60 * 1000) {
    throw new Error('Expected interested viewing follow-up to be ~1 hour from now')
  }
  console.log('[smoke] completed viewing advanced inquiry to offer with +1h follow-up')

  // No-show viewing
  const viewing3 = await requestJson('/api/viewings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      inquiry_id: inquiry.id,
      property_id: property.id,
      scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      mode: 'in_person',
      location: 'Property entrance',
      notes: 'Smoke no-show viewing',
    }),
  })
  if (!viewing3?.id) {
    throw new Error('Expected third viewing to be created')
  }
  const noShow = await requestJson(`/api/viewings/${viewing3.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ status: 'no_show' }),
  })
  if (noShow.status !== 'no_show' || noShow.outcome !== 'no_show') {
    throw new Error('Expected viewing to be marked no_show')
  }
  const inquiryAfterNoShow = await requestJson(`/api/inquiries/${inquiry.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const noShowFollowUpMs = new Date(inquiryAfterNoShow.next_follow_up_at).getTime()
  const expectedNoShowFollowUpMs = Date.now() + 2 * 60 * 60 * 1000
  if (Math.abs(noShowFollowUpMs - expectedNoShowFollowUpMs) > 5 * 60 * 1000) {
    throw new Error('Expected no-show viewing follow-up to be ~2 hours from now')
  }
  console.log('[smoke] no-show viewing generated +2h follow-up')

  // Inquiry timeline
  const timeline = await requestJson(`/api/inquiries/${inquiry.id}/timeline`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!timeline?.inquiry?.id || !Array.isArray(timeline.viewings) || timeline.viewings.length === 0) {
    throw new Error('Expected inquiry timeline to include viewings')
  }
  if (!Array.isArray(timeline.activities) || timeline.activities.length === 0) {
    throw new Error('Expected inquiry timeline to include activities')
  }
  console.log('[smoke] inquiry timeline returned viewings and activities')

  // ==================== REMINDER POLICY CRUD ====================
  const reminderPolicy = await requestJson('/api/reminder-policies', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      name: 'Smoke Viewing Reminders',
      owner_type: 'agent',
      appointment_type: 'viewing',
      rules: [
        { offset_minutes: 5, channels: ['inapp'], message_template: 'Custom reminder: viewing in {{minutes}} minutes.', active: true },
        { offset_minutes: 60, channels: ['email', 'inapp'], message_template: 'Custom reminder: viewing in {{minutes}} minutes.', active: true },
      ],
    }),
  })
  if (!reminderPolicy?.id || reminderPolicy.appointment_type !== 'viewing') {
    throw new Error('Expected reminder policy creation to return a viewing policy')
  }
  console.log('[smoke] reminder policy created')

  const policiesList = await requestJson('/api/reminder-policies', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(policiesList) || !policiesList.some((p) => p.id === reminderPolicy.id)) {
    throw new Error('Expected /api/reminder-policies to include created policy')
  }

  const policyPatched = await requestJson(`/api/reminder-policies/${reminderPolicy.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ name: 'Smoke Viewing Reminders Updated' }),
  })
  if (policyPatched.name !== 'Smoke Viewing Reminders Updated') {
    throw new Error('Expected reminder policy patch to update name')
  }
  console.log('[smoke] reminder policy updated')

  // Custom policy applied: viewing scheduled 2 minutes from now should trigger the 5-minute rule
  // because the reminder fire time (scheduled_at - 5 min) is already in the past.
  const customPolicyViewing = await requestJson('/api/viewings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      inquiry_id: inquiry.id,
      property_id: property.id,
      scheduled_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      mode: 'virtual',
      location: 'Zoom link',
      notes: 'Smoke custom policy viewing',
    }),
  })
  if (!customPolicyViewing?.id) {
    throw new Error('Expected custom-policy viewing to be created')
  }

  const customPolicyRun = await requestJson('/api/automation/consumer/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ scope: 'self', force_alerts: true }),
  })
  if (!Number.isFinite(Number(customPolicyRun?.summary?.reminders_sent))) {
    throw new Error('Expected custom policy automation run to include reminders_sent')
  }

  const customPolicyViewingAfterRun = await requestJson(`/api/viewings/${customPolicyViewing.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(customPolicyViewingAfterRun.reminders_sent) || customPolicyViewingAfterRun.reminders_sent.length === 0) {
    throw new Error('Expected custom-policy viewing to have reminders_sent after automation run')
  }
  const hasCustomReminder = customPolicyViewingAfterRun.reminders_sent.some((r) => r.offset_minutes === 5)
  if (!hasCustomReminder) {
    throw new Error('Expected custom 5-minute reminder to be recorded for the viewing')
  }
  console.log('[smoke] custom reminder policy applied to viewing')

  await requestJson(`/api/reminder-policies/${reminderPolicy.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const policiesAfterDelete = await requestJson('/api/reminder-policies', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (policiesAfterDelete.some((p) => p.id === reminderPolicy.id)) {
    throw new Error('Expected reminder policy delete to remove the policy')
  }
  console.log('[smoke] reminder policy deleted')

  // Worker edge-window tests: viewing reminder + auto no-show
  const health = await requestJson('/api/health')
  const reminderLeadMinutes = Number(health?.consumer_automation_worker?.viewing_reminder_lead_minutes || 120)
  const noShowGraceMinutes = Number(health?.consumer_automation_worker?.viewing_no_show_grace_minutes || 90)

  const viewingReminder = await requestJson('/api/viewings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      inquiry_id: inquiry.id,
      property_id: property.id,
      scheduled_at: new Date(Date.now() + (reminderLeadMinutes - 5) * 60 * 1000).toISOString(),
      mode: 'virtual',
      location: 'Zoom link',
      notes: 'Smoke reminder-eligible viewing',
    }),
  })
  if (!viewingReminder?.id) {
    throw new Error('Expected reminder viewing to be created')
  }

  const noShowAutomation = await requestJson('/api/viewings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      inquiry_id: inquiry.id,
      property_id: property.id,
      scheduled_at: new Date(Date.now() - (noShowGraceMinutes + 5) * 60 * 1000).toISOString(),
      mode: 'in_person',
      location: 'Property entrance',
      notes: 'Smoke no-show automation viewing',
    }),
  })
  if (!noShowAutomation?.id) {
    throw new Error('Expected no-show automation viewing to be created')
  }

  const automationRunForViewings = await requestJson('/api/automation/consumer/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ scope: 'self', force_alerts: true }),
  })
  if (!Number.isFinite(Number(automationRunForViewings?.summary?.reminders_sent))) {
    throw new Error('Expected automation run summary to include reminders_sent')
  }
  if (!Number.isFinite(Number(automationRunForViewings?.summary?.no_shows_marked))) {
    throw new Error('Expected automation run summary to include no_shows_marked')
  }

  const reminderViewingAfterRun = await requestJson(`/api/viewings/${viewingReminder.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(reminderViewingAfterRun.reminders_sent) || reminderViewingAfterRun.reminders_sent.length === 0) {
    throw new Error('Expected reminder-eligible viewing to have reminders_sent after automation run')
  }

  const noShowViewingAfterRun = await requestJson(`/api/viewings/${noShowAutomation.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (noShowViewingAfterRun.status !== 'no_show') {
    throw new Error('Expected past viewing to be auto-marked no_show by worker')
  }

  const notificationsAfterWorker = await requestJson('/api/notifications', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!notificationsAfterWorker.items.some((n) => n.type === 'viewing_reminder')) {
    throw new Error('Expected worker to generate viewing_reminder notification')
  }
  if (!notificationsAfterWorker.items.some((n) => n.type === 'viewing_no_show')) {
    throw new Error('Expected worker to generate viewing_no_show notification')
  }
  console.log('[smoke] worker edge windows verified (reminder + auto no-show)')

  // Worker metrics endpoint
  const metrics = await requestJson('/api/automation/consumer/metrics', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!metrics?.aggregates || typeof metrics.aggregates.total_runs !== 'number') {
    throw new Error('Expected automation consumer metrics to return aggregates')
  }
  console.log('[smoke] automation consumer metrics endpoint responded')

  const savedSearch = await requestJson('/api/saved-searches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      name: 'Smoke Beirut buy',
      filters: { type: 'sale', city: 'Beirut' },
      alert_enabled: true,
      alert_channel: 'inapp',
      alert_frequency: 'daily',
    }),
  })
  if (!savedSearch?.id) {
    throw new Error('Expected saved search creation to return id')
  }

  const alerts = await requestJson('/api/saved-searches/run-alerts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: '{}',
  })
  if (!Number.isFinite(Number(alerts?.searches_processed)) || Number(alerts?.searches_processed) < 1) {
    throw new Error('Expected saved-search alerts run to process at least one search')
  }
  console.log('[smoke] saved-search alerts run completed')

  const automationRun = await requestJson('/api/automation/consumer/run', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({ scope: 'self', force_alerts: true }),
  })
  if (!automationRun?.summary || !Number.isFinite(Number(automationRun.summary.searches_processed))) {
    throw new Error('Expected consumer automation run to return a summary payload')
  }

  const notifications = await requestJson('/api/notifications', {
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
  })
  if (!Array.isArray(notifications?.items)) {
    throw new Error('Expected /api/notifications to return paginated items array')
  }
  if (!notifications.items.some((n) => n.type === 'saved_search_match')) {
    throw new Error('Expected consumer automation to generate at least one saved_search_match notification')
  }

  const paginatedInquiries = await requestJson('/api/inquiries?limit=10', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(paginatedInquiries?.items) || typeof paginatedInquiries.has_more !== 'boolean') {
    throw new Error('Expected /api/inquiries to return paginated response shape')
  }
  console.log('[smoke] paginated notifications and inquiries shape verified')

  const initialSavedSearchMatchCount = notifications.items.filter((n) => n.type === 'saved_search_match').length

  const dedupeAutomationRun = await requestJson('/api/automation/consumer/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ scope: 'self', force_alerts: true }),
  })
  if (!dedupeAutomationRun?.summary) {
    throw new Error('Expected repeated consumer automation run to return a summary')
  }
  const notificationsAfterDedupe = await requestJson('/api/notifications', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const savedSearchMatchCountAfterDedupe = notificationsAfterDedupe.items.filter((n) => n.type === 'saved_search_match').length
  if (savedSearchMatchCountAfterDedupe !== initialSavedSearchMatchCount) {
    throw new Error(`Expected dedupe to keep saved_search_match count unchanged; went from ${initialSavedSearchMatchCount} to ${savedSearchMatchCountAfterDedupe}`)
  }
  console.log('[smoke] notification dedupe across repeated automation runs verified')

  await requestJson('/api/notification-preferences', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ events: { saved_search_match: false } }),
  })
  console.log('[smoke] disabled saved_search_match notification preference')

  await requestJson('/api/saved-searches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      name: 'Smoke Beirut buy prefs test',
      filters: { type: 'sale', city: 'Beirut' },
      alert_enabled: true,
      alert_channel: 'inapp',
      alert_frequency: 'daily',
    }),
  })

  await requestJson('/api/saved-searches/run-alerts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: '{}',
  })

  const notificationsAfterDisable = await requestJson('/api/notifications', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const savedSearchMatchCountAfterDisable = notificationsAfterDisable.items.filter((n) => n.type === 'saved_search_match').length
  if (savedSearchMatchCountAfterDisable !== savedSearchMatchCountAfterDedupe) {
    throw new Error('Expected disabled saved_search_match preference to suppress new notification')
  }
  console.log('[smoke] notification preference enforcement verified')

  await requestJson('/api/notification-preferences', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ events: { saved_search_match: true } }),
  })

  await requestJson('/api/saved-searches/run-alerts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: '{}',
  })

  const notificationsAfterReenable = await requestJson('/api/notifications', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const savedSearchMatchCountAfterReenable = notificationsAfterReenable.items.filter((n) => n.type === 'saved_search_match').length
  if (savedSearchMatchCountAfterReenable <= savedSearchMatchCountAfterDisable) {
    throw new Error('Expected re-enabled saved_search_match preference to produce a new notification')
  }
  console.log('[smoke] notification preference re-enable verified')

  console.log('[smoke] consumer automation run and notifications verified')

  await requestJson('/api/my-connections', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      platform: 'instagram',
      handle: '@smoke_test_agent',
      account_name: 'Smoke Instagram',
    }),
  })
  console.log('[smoke] connected instagram account')

  const socialQueue = await requestJson(`/api/properties/${property.id}/distribute-own`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      platforms: ['instagram'],
      mode: 'publish',
      intent: 'distribute',
    }),
  })
  if (!Array.isArray(socialQueue) || socialQueue[0]?.status !== 'pending_retry') {
    throw new Error('Expected instagram distribution to be queued as pending_retry')
  }
  console.log('[smoke] instagram distribution queued as pending_retry')

  const workerRun = await requestJson('/api/distributions/retry-worker/run', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      scope: 'self',
      due_only: false,
      limit: 5,
    }),
  })
  if (!Number.isFinite(Number(workerRun?.processed)) || Number(workerRun?.processed) < 1) {
    throw new Error('Expected retry worker run to process at least one queued distribution')
  }
  console.log(`[smoke] retry worker run processed ${workerRun.processed}`)

  const distributionsAfterWorker = await requestJson(`/api/properties/${property.id}/distributions`, {
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
  })
  const workerUpdatedRow = Array.isArray(distributionsAfterWorker)
    ? distributionsAfterWorker.find((d) => d.id === socialQueue[0].id)
    : null

  if (!workerUpdatedRow) {
    throw new Error('Could not find social distribution after worker run')
  }

  if (workerUpdatedRow.status === 'published') {
    console.log('[smoke] worker already published instagram distribution')
  } else {
    const retriedSocial = await requestJson(`/api/distributions/${socialQueue[0].id}/retry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${loginAfterChange.token}`,
      },
      body: '{}',
    })
    const allowedRetryStatuses = ['published', 'failed', 'pending_retry']
    if (!allowedRetryStatuses.includes(retriedSocial?.status)) {
      throw new Error(`Expected retry endpoint to return one of ${allowedRetryStatuses.join(', ')} for instagram distribution`)
    }
    if (retriedSocial?.status === 'pending_retry') {
      console.log('[smoke] instagram distribution retry endpoint re-queued pending_retry (expected when media/provider preconditions are still unmet)')
    } else {
      console.log(`[smoke] instagram distribution retry endpoint returned terminal state ${retriedSocial?.status}`)
    }
  }

  const waFailure = await requestJsonExpectError(`/api/properties/${property.id}/distribute-own`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${loginAfterChange.token}`,
    },
    body: JSON.stringify({
      platforms: ['whatsapp'],
      mode: 'publish',
      intent: 'distribute',
    }),
  })
  if (waFailure.payload?.fatal_channel !== 'whatsapp') {
    throw new Error('Expected WhatsApp to hard-fail with fatal_channel=whatsapp')
  }
  console.log('[smoke] whatsapp distribution hard-failed as expected')

  // ==================== CONVERSATION ORCHESTRATOR ====================
  const clientPhone = `+96171${String(now).slice(-6)}`
  const webhookPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-test',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '1234567890', phone_number_id: 'phone-test' },
          contacts: [{ profile: { name: 'Smoke Buyer WA' }, wa_id: clientPhone.replace(/\D/g, '') }],
          messages: [{
            from: clientPhone.replace(/\D/g, ''),
            id: `wamid.smoke.${now}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            text: { body: 'Hello, I am interested in a property.' },
            type: 'text',
          }],
        },
        field: 'messages',
      }],
    }],
  }

  const webhookResult = await requestJson('/api/webhooks/whatsapp', {
    method: 'POST',
    body: JSON.stringify(webhookPayload),
  })
  console.log('[smoke] whatsapp inbound webhook acknowledged')

  const messageResult = webhookResult?.results?.find((r) => r.type === 'message')
  if (!messageResult?.conversation_id) {
    throw new Error('Expected WhatsApp inbound webhook to create a conversation')
  }
  let conversationId = messageResult.conversation_id
  const contactAId = messageResult.contact_id

  // Assign to self so the remaining agent-scoped endpoints work
  const assigned = await requestJson(`/api/conversations/${conversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (assigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected conversation assignment to set assigned_agent_id')
  }
  console.log(`[smoke] conversation ${conversationId} assigned to agent`)

  const conversations = await requestJson('/api/conversations', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(conversations) || conversations.length === 0) {
    throw new Error('Expected /api/conversations to return the assigned thread')
  }
  const conversation = conversations.find((c) => c.id === conversationId)
  if (!conversation) {
    throw new Error('Assigned conversation not returned by /api/conversations')
  }
  if (conversation.unread_count !== 1) {
    throw new Error(`Expected conversation unread_count to be 1, got ${conversation.unread_count}`)
  }
  console.log('[smoke] /api/conversations returned the inbound thread')

  const thread = await requestJson(`/api/conversations/${conversationId}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(thread.messages) || thread.messages.filter((m) => m.direction === 'inbound').length !== 1) {
    throw new Error('Expected conversation thread to include one inbound message')
  }
  if (!thread.contact || !thread.contact.id) {
    throw new Error('Expected conversation thread to include contact')
  }
  const contactA = thread.contact
  console.log(`[smoke] /api/conversations/${conversationId} returned thread with contact ${contactA.id}`)

  // Agent outbound reply
  const reply = await requestJson(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Thanks for reaching out! How can I help?' }),
  })
  if (!reply?.message?.id || reply.message.direction !== 'outbound') {
    throw new Error('Expected agent reply to create an outbound message')
  }
  console.log('[smoke] agent outbound reply created')

  // Mark conversation read
  const markedRead = await requestJson(`/api/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: '{}',
  })
  if (markedRead.unread_count !== 0) {
    throw new Error('Expected mark-read to reset unread_count')
  }
  console.log('[smoke] conversation marked as read')

  // Close and reopen
  const closed = await requestJson(`/api/conversations/${conversationId}/close`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ reason: 'Smoke test complete' }),
  })
  if (closed.status !== 'closed') {
    throw new Error('Expected conversation to be closed')
  }
  console.log('[smoke] conversation closed')

  // Contact merge: create a second contact via inquiry then merge into the WhatsApp contact
  const mergePhone = `+96172${String(now).slice(-6)}`
  const inquiryForMerge = await requestJson('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      property_id: property.id,
      property_title: property.title,
      name: 'Smoke Merge Lead',
      email: `merge.${now}@example.com`,
      phone: mergePhone,
      message: 'I also reached out via the website form.',
      source: 'marketplace',
      channel: 'web',
    }),
  })
  if (!inquiryForMerge?.contact_id) {
    throw new Error('Expected inquiry to create a contact_id for merge test')
  }
  const contactBId = inquiryForMerge.contact_id

  const contactsBeforeMerge = await requestJson('/api/contacts', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const sourceContact = contactsBeforeMerge.find((c) => c.id === contactA.id)
  const targetContact = contactsBeforeMerge.find((c) => c.id === contactBId)
  if (!sourceContact || !targetContact) {
    throw new Error('Expected both contacts to exist before merge')
  }

  const merged = await requestJson(`/api/contacts/${sourceContact.id}/merge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ target_contact_id: targetContact.id }),
  })
  if (!merged?.id) {
    throw new Error('Expected contact merge to return a merged contact')
  }
  const contactsAfterMerge = await requestJson('/api/contacts', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (contactsAfterMerge.some((c) => c.id === targetContact.id)) {
    throw new Error('Expected merged target contact to be removed')
  }
  const mergedContact = contactsAfterMerge.find((c) => c.id === merged.id)
  if (!mergedContact) {
    throw new Error('Expected merged source contact to remain')
  }
  console.log(`[smoke] contacts merged into ${merged.id}`)

  // ==================== SMS ORCHESTRATOR (dev simulation) ====================
  const smsPhone = `+96173${String(now).slice(-6)}`
  const smsInbound = await requestJson('/api/webhooks/sms', {
    method: 'POST',
    body: JSON.stringify({
      From: smsPhone,
      To: '+1234567890',
      Body: 'Can you show me apartments in Beirut?',
      MessageSid: `SM${now}`,
      NumMedia: 0,
    }),
  })
  console.log('[smoke] sms inbound webhook acknowledged')

  const smsMessageResult = smsInbound?.results?.find((r) => r.type === 'message')
  if (!smsMessageResult?.conversation_id) {
    throw new Error('Expected SMS inbound webhook to create a conversation')
  }
  const smsConversationId = smsMessageResult.conversation_id

  const smsAssigned = await requestJson(`/api/conversations/${smsConversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (smsAssigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected SMS conversation assignment to set assigned_agent_id')
  }

  const smsReply = await requestJson(`/api/conversations/${smsConversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Absolutely, I have several listings in Beirut. What is your budget?' }),
  })
  if (!smsReply?.message?.id || smsReply.message.direction !== 'outbound') {
    throw new Error('Expected agent SMS reply to create an outbound message')
  }
  if (!smsReply.dispatch?.simulated) {
    throw new Error('Expected SMS reply to use dev simulation')
  }
  console.log('[smoke] sms outbound reply simulated')

  // ==================== EMAIL ORCHESTRATOR (dev simulation) ====================
  const emailAddress = `buyer.${now}@smoke.test`
  const emailInbound = await requestJson('/api/webhooks/email', {
    method: 'POST',
    body: JSON.stringify({
      from: emailAddress,
      to: 'agency@souqajjar.com',
      subject: 'Question about a listing',
      text: 'Hello, I saw your listing and I have a few questions.',
      message_id: `email.${now}@smoke.test`,
    }),
  })
  console.log('[smoke] email inbound webhook acknowledged')

  const emailMessageResult = emailInbound?.results?.find((r) => r.type === 'message')
  if (!emailMessageResult?.conversation_id) {
    throw new Error('Expected email inbound webhook to create a conversation')
  }
  const emailConversationId = emailMessageResult.conversation_id

  const emailAssigned = await requestJson(`/api/conversations/${emailConversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (emailAssigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected email conversation assignment to set assigned_agent_id')
  }

  const emailReply = await requestJson(`/api/conversations/${emailConversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      content: 'Thank you for your interest. Which listing are you asking about?',
      subject: 'RE: Question about a listing',
    }),
  })
  if (!emailReply?.message?.id || emailReply.message.direction !== 'outbound') {
    throw new Error('Expected agent email reply to create an outbound message')
  }
  if (!emailReply.dispatch?.simulated) {
    throw new Error('Expected email reply to use dev simulation')
  }
  console.log('[smoke] email outbound reply simulated')

  // ==================== INSTAGRAM ORCHESTRATOR (dev simulation) ====================
  const instagramDmHandle = `ig_dm_${now}`
  const instagramDmInbound = await requestJson('/api/webhooks/instagram', {
    method: 'POST',
    body: JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'page-test',
        messaging: [{
          sender: { id: instagramDmHandle, username: 'Smoke IG Buyer' },
          recipient: { id: 'page-recipient' },
          timestamp: Date.now(),
          message: {
            mid: `instagram_dm_${now}`,
            text: 'Hi, do you have any sea view apartments?',
          },
        }],
      }],
    }),
  })
  console.log('[smoke] instagram DM inbound webhook acknowledged')

  const dmMessageResult = instagramDmInbound?.results?.find((r) => r.type === 'dm')
  if (!dmMessageResult?.conversation_id) {
    throw new Error('Expected Instagram DM inbound webhook to create a conversation')
  }
  const dmConversationId = dmMessageResult.conversation_id

  const dmAssigned = await requestJson(`/api/conversations/${dmConversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (dmAssigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected Instagram DM conversation assignment to set assigned_agent_id')
  }

  const dmReply = await requestJson(`/api/conversations/${dmConversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Yes, we have sea view apartments in Beirut. Let me send you a few options.' }),
  })
  if (!dmReply?.message?.id || dmReply.message.direction !== 'outbound') {
    throw new Error('Expected agent Instagram DM reply to create an outbound message')
  }
  if (!dmReply.dispatch?.simulated) {
    throw new Error('Expected Instagram DM reply to use dev simulation')
  }
  console.log('[smoke] instagram DM outbound reply simulated')

  const instagramCommentFrom = `ig_comment_${now}`
  const instagramCommentInbound = await requestJson('/api/webhooks/instagram', {
    method: 'POST',
    body: JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'page-test',
        changes: [{
          field: 'comments',
          value: {
            comment_id: `instagram_comment_${now}`,
            media_id: `media_${now}`,
            from: { id: instagramCommentFrom, username: 'Smoke IG Commenter' },
            text: 'Is this property still available?',
          },
        }],
      }],
    }),
  })
  console.log('[smoke] instagram comment inbound webhook acknowledged')

  const commentMessageResult = instagramCommentInbound?.results?.find((r) => r.type === 'comment')
  if (!commentMessageResult?.conversation_id) {
    throw new Error('Expected Instagram comment inbound webhook to create a conversation')
  }
  const commentConversationId = commentMessageResult.conversation_id

  const commentAssigned = await requestJson(`/api/conversations/${commentConversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (commentAssigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected Instagram comment conversation assignment to set assigned_agent_id')
  }

  const commentConversation = await requestJson(`/api/conversations/${commentConversationId}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (commentConversation.visibility !== 'public') {
    throw new Error('Expected Instagram comment conversation to have public visibility')
  }

  const commentReply = await requestJson(`/api/conversations/${commentConversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Yes, please DM us for details and viewings.' }),
  })
  if (!commentReply?.message?.id || commentReply.message.direction !== 'outbound') {
    throw new Error('Expected agent Instagram comment reply to create an outbound message')
  }
  if (!commentReply.dispatch?.simulated) {
    throw new Error('Expected Instagram comment reply to use dev simulation')
  }
  console.log('[smoke] instagram comment outbound reply simulated')

  // ==================== CRM MATURITY (tasks + opportunities + timeline) ====================
  const task = await requestJson('/api/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      title: 'Smoke follow-up call',
      due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      priority: 'high',
      type: 'call',
      notes: 'Created by smoke test',
    }),
  })
  if (!task?.id || task.status !== 'pending') {
    throw new Error('Expected task creation to return a pending task')
  }
  console.log('[smoke] task created')

  const tasksList = await requestJson('/api/tasks', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(tasksList.items) || !tasksList.items.some((t) => t.id === task.id)) {
    throw new Error('Expected /api/tasks to include the created task')
  }

  const completedTask = await requestJson(`/api/tasks/${task.id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: '{}',
  })
  if (completedTask.status !== 'completed') {
    throw new Error('Expected task completion to mark status completed')
  }
  console.log('[smoke] task completed')

  const opportunities = await requestJson('/api/opportunities', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(opportunities)) {
    throw new Error('Expected /api/opportunities to return an array')
  }
  const interestedOpportunity = opportunities.find((o) => o.contact_id === inquiry.contact_id && o.stage === 'offer')
  if (!interestedOpportunity) {
    throw new Error('Expected interested viewing to create or advance an opportunity to offer stage')
  }
  console.log(`[smoke] opportunity found at ${interestedOpportunity.stage} stage`)

  const note = await requestJson(`/api/contacts/${inquiry.contact_id}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Smoke test contact note' }),
  })
  if (!note?.id) {
    throw new Error('Expected contact note creation to return a note id')
  }

  const contactTimeline = await requestJson(`/api/contacts/${inquiry.contact_id}/timeline`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!contactTimeline?.contact?.id || !Array.isArray(contactTimeline.events) || contactTimeline.events.length === 0) {
    throw new Error('Expected contact timeline to include events')
  }
  if (!contactTimeline.events.some((e) => e.type === 'note')) {
    throw new Error('Expected contact timeline to include the manual note')
  }
  if (!contactTimeline.events.some((e) => e.type === 'opportunity')) {
    throw new Error('Expected contact timeline to include opportunity event')
  }
  console.log('[smoke] contact timeline includes notes and opportunities')

  const ops = await requestJson('/api/dashboard/operations', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!ops || typeof ops.tasks !== 'object' || typeof ops.pipeline !== 'object') {
    throw new Error('Expected dashboard operations to include tasks and pipeline objects')
  }
  if (typeof ops.tasks.overdue_count !== 'number' || typeof ops.pipeline.total_value !== 'number') {
    throw new Error('Expected dashboard operations to expose task counts and pipeline value')
  }
  console.log('[smoke] dashboard operations includes tasks and pipeline summary')

  // ==================== CRM ANALYTICS (Phase D) ====================
  const crmAnalytics = await requestJson('/api/analytics/crm', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!crmAnalytics || typeof crmAnalytics.summary !== 'object' || typeof crmAnalytics.pipeline !== 'object') {
    throw new Error('Expected CRM analytics to include summary and pipeline objects')
  }
  if (typeof crmAnalytics.summary.contacts_created !== 'number' || typeof crmAnalytics.summary.total_pipeline_value !== 'number') {
    throw new Error('Expected CRM analytics summary to expose contacts and pipeline value')
  }
  if (!Array.isArray(crmAnalytics.lead_sources) || !Array.isArray(crmAnalytics.revenue_forecast)) {
    throw new Error('Expected CRM analytics to include lead_sources and revenue_forecast arrays')
  }
  console.log('[smoke] CRM analytics endpoint returns expected shape')

  const commAnalytics = await requestJson('/api/analytics/communications', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!commAnalytics || typeof commAnalytics.summary !== 'object') {
    throw new Error('Expected communications analytics to include summary object')
  }
  if (typeof commAnalytics.summary.conversations_total !== 'number' || typeof commAnalytics.summary.messages_total !== 'number') {
    throw new Error('Expected communications analytics summary to expose conversation and message counts')
  }
  if (!commAnalytics.first_response_time || typeof commAnalytics.first_response_time.sample_count !== 'number') {
    throw new Error('Expected communications analytics to include first_response_time metrics')
  }
  if (!Array.isArray(commAnalytics.channel_volume)) {
    throw new Error('Expected communications analytics to include channel_volume array')
  }
  console.log('[smoke] communications analytics endpoint returns expected shape')

  // ==================== TIKTOK ORCHESTRATOR (dev simulation) ====================
  const tiktokHandle = `tiktok_${now}`
  const tiktokInbound = await requestJson('/api/webhooks/tiktok', {
    method: 'POST',
    body: JSON.stringify({
      comments: [{
        id: `tiktok_comment_${now}`,
        user_id: tiktokHandle,
        username: 'Smoke TikToker',
        text: 'Is this apartment pet friendly?',
        video_id: `video_${now}`,
        created_at: new Date().toISOString(),
      }],
    }),
  })
  console.log('[smoke] tiktok inbound webhook acknowledged')
  const tiktokCommentResult = tiktokInbound?.results?.find((r) => r.type === 'comment')
  if (!tiktokCommentResult?.conversation_id) {
    throw new Error('Expected TikTok comment inbound webhook to create a conversation')
  }
  const tiktokConversationId = tiktokCommentResult.conversation_id
  const tiktokAssigned = await requestJson(`/api/conversations/${tiktokConversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (tiktokAssigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected TikTok conversation assignment to set assigned_agent_id')
  }
  const tiktokReply = await requestJson(`/api/conversations/${tiktokConversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Yes, pets are allowed in selected units. Please DM us for details.' }),
  })
  if (!tiktokReply?.message?.id || tiktokReply.message.direction !== 'outbound') {
    throw new Error('Expected agent TikTok comment reply to create an outbound message')
  }
  if (!tiktokReply.dispatch?.simulated) {
    throw new Error('Expected TikTok comment reply to use dev simulation')
  }
  console.log('[smoke] tiktok comment outbound reply simulated')

  // ==================== X ORCHESTRATOR (dev simulation) ====================
  const xHandle = `x_${now}`
  const xInbound = await requestJson('/api/webhooks/x', {
    method: 'POST',
    body: JSON.stringify({
      mentions: [{
        id: `x_mention_${now}`,
        user_id: xHandle,
        username: 'SmokeXUser',
        text: 'Do you have any sea view listings in Jounieh?',
        tweet_id: `tweet_${now}`,
        created_at: new Date().toISOString(),
      }],
    }),
  })
  console.log('[smoke] x inbound webhook acknowledged')
  const xMentionResult = xInbound?.results?.find((r) => r.type === 'mention')
  if (!xMentionResult?.conversation_id) {
    throw new Error('Expected X mention inbound webhook to create a conversation')
  }
  const xConversationId = xMentionResult.conversation_id
  const xAssigned = await requestJson(`/api/conversations/${xConversationId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ agent_id: loginAfterChange.agent.id }),
  })
  if (xAssigned.assigned_agent_id !== loginAfterChange.agent.id) {
    throw new Error('Expected X conversation assignment to set assigned_agent_id')
  }
  const xReply = await requestJson(`/api/conversations/${xConversationId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ content: 'Yes — we have sea view apartments in Jounieh. Please DM us to schedule a viewing.' }),
  })
  if (!xReply?.message?.id || xReply.message.direction !== 'outbound') {
    throw new Error('Expected agent X mention reply to create an outbound message')
  }
  if (!xReply.dispatch?.simulated) {
    throw new Error('Expected X mention reply to use dev simulation')
  }
  console.log('[smoke] x mention outbound reply simulated')

  // ==================== CAMPAIGNS / DRIP SEQUENCES ====================
  const campaignTemplate = await requestJson('/api/message-templates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      name: 'Smoke Nurture Email',
      channel: 'email',
      category: 'follow_up',
      subject: 'Welcome {{client_name}}',
      body: 'Hi {{client_name}},\n\nWelcome! I\'m {{agent_name}} and I\'d be happy to help you find the right property.',
      language: 'en',
      approval_status: 'approved',
    }),
  })
  if (!campaignTemplate?.id) {
    throw new Error('Expected campaign email template to be created')
  }
  console.log('[smoke] campaign email template created')

  const campaign = await requestJson('/api/campaigns', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      name: 'Smoke Nurture Sequence',
      description: 'A test drip campaign for smoke test',
      status: 'active',
      trigger: 'manual',
      target_channel: 'email',
      steps: [
        { delay_hours: 0, channel: 'email', template_id: campaignTemplate.id },
        { delay_hours: 1, channel: 'email', subject: 'Step 2', body: 'Here are some listings you may like.' },
      ],
    }),
  })
  if (!campaign?.id || !Array.isArray(campaign.steps) || campaign.steps.length !== 2) {
    throw new Error('Expected campaign creation to return a campaign with two steps')
  }
  if (!campaign.steps[0].template_id) {
    throw new Error('Expected campaign step to store template_id')
  }
  console.log('[smoke] campaign created')

  const campaignsList = await requestJson('/api/campaigns', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(campaignsList) || !campaignsList.some((c) => c.id === campaign.id)) {
    throw new Error('Expected /api/campaigns to include the created campaign')
  }

  const enrollment = await requestJson(`/api/campaigns/${campaign.id}/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ contact_id: inquiry.contact_id }),
  })
  if (!enrollment?.id || enrollment.status !== 'active' || enrollment.campaign_id !== campaign.id) {
    throw new Error('Expected campaign enrollment to be active and linked to campaign')
  }
  console.log('[smoke] campaign enrollment created')

  const schedulerRun = await requestJson('/api/campaigns/run-scheduler', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ limit: 10 }),
  })
  if (typeof schedulerRun.processed !== 'number') {
    throw new Error('Expected campaign scheduler run to return processed count')
  }
  if (schedulerRun.sent < 1) {
    throw new Error(`Expected campaign scheduler to send at least 1 message, got ${schedulerRun.sent}`)
  }
  console.log('[smoke] campaign scheduler run completed')

  const enrollmentAfterRun = await requestJson(`/api/enrollments/${enrollment.id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (enrollmentAfterRun.status !== 'active' && enrollmentAfterRun.status !== 'completed') {
    throw new Error('Expected enrollment to remain active or be completed after scheduler run')
  }
  console.log('[smoke] campaign enrollment status verified')

  const contactExport = await requestJson(`/api/contacts/${inquiry.contact_id}/export`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const campaignMessages = contactExport?.related?.campaign_messages || []
  const campaignMessage = campaignMessages.find((m) => m.enrollment_id === enrollment.id && m.step_index === 0)
  if (!campaignMessage) {
    throw new Error('Expected campaign_messages record for the first step')
  }
  if (campaignMessage.status !== 'sent') {
    throw new Error(`Expected campaign message status to be sent, got ${campaignMessage.status}`)
  }
  if (!campaignMessage.conversation_id || !campaignMessage.message_id) {
    throw new Error('Expected campaign message to reference a conversation and message')
  }

  const campaignConversation = await requestJson(`/api/conversations/${campaignMessage.conversation_id}`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const outboundEmail = (campaignConversation?.messages || []).find(
    (m) => m.id === campaignMessage.message_id && m.direction === 'outbound' && m.channel === 'email',
  )
  if (!outboundEmail) {
    throw new Error('Expected outbound email conversation message to match campaign message_id')
  }
  if (!outboundEmail.content?.includes('Welcome')) {
    throw new Error('Expected outbound email content to contain rendered template text')
  }
  console.log('[smoke] campaign auto-dispatch verified')

  // ==================== MESSAGE TEMPLATES ====================
  const defaultTemplates = await requestJson('/api/message-templates/defaults', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(defaultTemplates) || defaultTemplates.length === 0) {
    throw new Error('Expected default message templates to be seeded')
  }
  console.log('[smoke] default message templates seeded')

  const newTemplate = await requestJson('/api/message-templates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      name: 'Smoke Test Template',
      channel: 'email',
      category: 'follow_up',
      subject: 'Hi {{client_name}}',
      body: 'Hello {{client_name}}, this is {{agent_name}} following up on {{property_title}}.',
      language: 'en',
    }),
  })
  if (!newTemplate?.id || newTemplate.channel !== 'email' || !newTemplate.variables?.includes('client_name')) {
    throw new Error('Expected message template creation to return a template with variables')
  }
  console.log('[smoke] message template created')

  const myTemplates = await requestJson('/api/message-templates', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(myTemplates) || !myTemplates.some((t) => t.id === newTemplate.id)) {
    throw new Error('Expected /api/message-templates to include the created template')
  }
  console.log('[smoke] message templates list includes created template')

  const renderResult = await requestJson(`/api/message-templates/${newTemplate.id}/render`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({
      variables: {
        client_name: 'Smoke Buyer',
        agent_name: 'Smoke Agent',
        property_title: 'Smoke Property',
      },
    }),
  })
  if (!renderResult?.body?.includes('Smoke Buyer') || !renderResult?.body?.includes('Smoke Agent')) {
    throw new Error('Expected rendered template to substitute variables')
  }
  console.log('[smoke] message template render substitutes variables')

  const updatedTemplate = await requestJson(`/api/message-templates/${newTemplate.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
    body: JSON.stringify({ name: 'Smoke Test Template Updated' }),
  })
  if (updatedTemplate.name !== 'Smoke Test Template Updated') {
    throw new Error('Expected message template patch to update name')
  }
  console.log('[smoke] message template updated')

  await requestJson(`/api/message-templates/${newTemplate.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const templatesAfterDelete = await requestJson('/api/message-templates', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (templatesAfterDelete.some((t) => t.id === newTemplate.id)) {
    throw new Error('Expected message template delete to remove the template')
  }
  console.log('[smoke] message template deleted')

  // ==================== GDPR DELETE / EXPORT ====================
  const gdprExport = await requestJson(`/api/contacts/${inquiry.contact_id}/export`, {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!gdprExport?.contact?.id || !gdprExport.related || !gdprExport.exported_at) {
    throw new Error('Expected GDPR export to return contact and related data')
  }
  console.log('[smoke] GDPR contact export returned expected shape')

  await requestJson(`/api/contacts/${inquiry.contact_id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  const contactsAfterDelete = await requestJson('/api/contacts', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (contactsAfterDelete.some((c) => c.id === inquiry.contact_id)) {
    throw new Error('Expected GDPR contact delete to remove the contact')
  }
  console.log('[smoke] GDPR contact delete removed contact')

  // ==================== WHATSAPP LISTINGS MODULE ====================
  const moduleHealth = await requestJson('/api/health')
  if (!moduleHealth?.whatsapp_listings || moduleHealth.whatsapp_listings.enabled !== true) {
    throw new Error('Expected WhatsApp Listings module to be enabled in health response')
  }
  console.log('[smoke] whatsapp-listings module enabled in health response')

  const agentCredits = await requestJson('/api/agent/credits/balance', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (typeof agentCredits?.credits_remaining !== 'number') {
    throw new Error('Expected agent credit balance to return credits_remaining')
  }
  console.log('[smoke] agent credit balance endpoint available')

  const agentDrafts = await requestJson('/api/agent/whatsapp-listings/drafts', {
    headers: { Authorization: `Bearer ${loginAfterChange.token}` },
  })
  if (!Array.isArray(agentDrafts)) {
    throw new Error('Expected agent WhatsApp listings drafts endpoint to return an array')
  }
  console.log('[smoke] agent WhatsApp listings drafts endpoint available')

  if (adminToken) {
    const adminUsage = await requestJson('/api/admin/whatsapp-listings/usage', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    if (typeof adminUsage?.total_drafts !== 'number') {
      throw new Error('Expected admin WhatsApp listings usage endpoint to return total_drafts')
    }
    console.log('[smoke] admin WhatsApp listings usage endpoint available')
  }

  console.log(`[smoke] backend responded successfully at ${baseUrl}`)
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error.message}`)
  process.exit(1)
})
