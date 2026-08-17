/**
 * Pure helpers for the platform-template admin surface. Extracted so they
 * can be unit-tested without a DOM.
 */

import type {
  PlatformMessageTemplate,
  PlatformTemplateCategory,
  PlatformTemplateChannel,
} from '@/types/platformTemplates'

/**
 * Extract the unique set of {{variable}} names referenced by a template
 * string. Mirrors the backend's variables.js so the admin UI can preview
 * variable coverage without a round-trip.
 */
const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g

export function extractVariables(source: string | null | undefined): string[] {
  if (!source) return []
  const seen = new Set<string>()
  const result: string[] = []
  const matches = source.matchAll(VARIABLE_RE)
  for (const match of matches) {
    const name = match[1]
    if (!seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

export function extractAllVariables(template: {
  subject?: string | null
  html_body?: string | null
  text_body?: string | null
}): string[] {
  const seen = new Set<string>()
  for (const part of [template.subject, template.html_body, template.text_body]) {
    for (const name of extractVariables(part)) seen.add(name)
  }
  return [...seen]
}

/**
 * Diagnostic buckets shown on the Variables tab.
 *
 * - `required_present` — every required variable IS referenced somewhere.
 * - `required_missing` — required but not referenced. Blocks save.
 * - `optional_referenced` — optional AND referenced. Green tick.
 * - `optional_unreferenced` — optional but not referenced. Informational.
 * - `unknown_referenced` — referenced but not in required/optional.
 *   Renders as blank at runtime — warn, don't block.
 */
export interface VariableDiagnostics {
  required_present: string[]
  required_missing: string[]
  optional_referenced: string[]
  optional_unreferenced: string[]
  unknown_referenced: string[]
  all_referenced: string[]
}

export function computeVariableDiagnostics(template: {
  subject?: string | null
  html_body?: string | null
  text_body?: string | null
  required_variables?: string[]
  optional_variables?: string[]
}): VariableDiagnostics {
  const referenced = new Set(extractAllVariables(template))
  const required = new Set(template.required_variables || [])
  const optional = new Set(template.optional_variables || [])

  const required_present: string[] = []
  const required_missing: string[] = []
  for (const name of required) {
    if (referenced.has(name)) required_present.push(name)
    else required_missing.push(name)
  }

  const optional_referenced: string[] = []
  const optional_unreferenced: string[] = []
  for (const name of optional) {
    if (referenced.has(name)) optional_referenced.push(name)
    else optional_unreferenced.push(name)
  }

  const known = new Set<string>()
  for (const n of required) known.add(n)
  for (const n of optional) known.add(n)
  const unknown_referenced = [...referenced].filter((n) => !known.has(n))

  return {
    required_present,
    required_missing,
    optional_referenced,
    optional_unreferenced,
    unknown_referenced,
    all_referenced: [...referenced],
  }
}

/** Presentational label for the channel enum. */
export function channelLabel(channel: PlatformTemplateChannel): string {
  switch (channel) {
    case 'email': return 'Email'
    case 'whatsapp': return 'WhatsApp'
    case 'sms': return 'SMS'
  }
}

/** Presentational label for the category enum. */
export function categoryLabel(category: PlatformTemplateCategory): string {
  const map: Record<PlatformTemplateCategory, string> = {
    auth: 'Authentication',
    onboarding: 'Onboarding',
    billing: 'Billing',
    notification: 'Notification',
    marketing: 'Marketing',
  }
  return map[category] || category
}

/**
 * A template is "publishable" (save-enabled) only when every required
 * variable is referenced. Everything else is a warning, not a blocker.
 */
export function isTemplatePublishable(template: {
  subject?: string | null
  html_body?: string | null
  text_body?: string | null
  required_variables?: string[]
  channel?: PlatformTemplateChannel
}): { ok: boolean; reason?: string } {
  const diag = computeVariableDiagnostics(template)
  if (diag.required_missing.length) {
    return {
      ok: false,
      reason: `Missing required variable(s): ${diag.required_missing.join(', ')}`,
    }
  }
  if (template.channel === 'email' && !template.subject?.trim()) {
    return { ok: false, reason: 'Email templates require a subject' }
  }
  const bodyPresent = (template.html_body?.trim() || template.text_body?.trim())
  if (!bodyPresent) {
    return { ok: false, reason: 'Template requires a body (HTML or text)' }
  }
  return { ok: true }
}

/**
 * Sensible default variables to seed the preview form with. Uses the
 * template's required + optional lists so the admin sees something in
 * the preview immediately without having to type anything.
 */
export function defaultPreviewVariables(template: {
  required_variables?: string[]
  optional_variables?: string[]
}): Record<string, string> {
  const out: Record<string, string> = {}
  const sample: Record<string, string> = {
    code: '123456',
    name: 'Ali Achkar',
    phone_number: '+96170123456',
    support_email: 'support@wingcaster.com',
    agency: 'Wingcaster Real Estate',
    email: 'agent@example.com',
  }
  const both = [...(template.required_variables || []), ...(template.optional_variables || [])]
  for (const name of both) {
    out[name] = sample[name] ?? `<${name}>`
  }
  return out
}

/**
 * Sort templates for display in the list page: active first, then code,
 * then language, then territory. Matches the backend `listTemplates`
 * order but is duplicated here so a client-side re-filter doesn't reorder
 * unexpectedly.
 */
export function sortTemplatesForList(templates: PlatformMessageTemplate[]): PlatformMessageTemplate[] {
  return [...templates].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    if (a.language !== b.language) return a.language.localeCompare(b.language)
    const at = a.territory_id || ''
    const bt = b.territory_id || ''
    return at.localeCompare(bt)
  })
}
