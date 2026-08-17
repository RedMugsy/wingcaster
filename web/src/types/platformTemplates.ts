/**
 * Types for platform message templates — the admin-editable copy the
 * platform sends to its tenants (signup OTP, welcome, WhatsApp guide, …).
 *
 * Distinct from the existing tenant-owned MessageTemplate types.
 */

export type PlatformTemplateChannel = 'email' | 'whatsapp' | 'sms'

export type PlatformTemplateCategory =
  | 'auth'
  | 'onboarding'
  | 'billing'
  | 'notification'
  | 'marketing'

export type PlatformTemplateEditorMode = 'unlayer' | 'mjml' | 'raw'

export interface PlatformMessageTemplate {
  id: string
  code: string
  display_name: string
  description: string | null
  channel: PlatformTemplateChannel
  category: PlatformTemplateCategory
  language: string
  territory_id: string | null
  subject: string | null
  html_body: string | null
  text_body: string | null
  /**
   * Unlayer's serialised builder state (or MJML source when
   * editor_mode='mjml'). Kept alongside html_body so an admin can re-edit
   * a template visually rather than being handed compiled HTML.
   */
  design_json: unknown | null
  editor_mode: PlatformTemplateEditorMode
  required_variables: string[]
  optional_variables: string[]
  is_active: boolean
  is_seed: boolean
  version: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

/**
 * A snapshot of a template's prior state, appended each time it's updated
 * or reverted. Only SUPERSEDED versions live here — the current state
 * lives on the parent row.
 */
export interface PlatformMessageTemplateVersion {
  id: string
  template_id: string
  version: number
  subject: string | null
  html_body: string | null
  text_body: string | null
  design_json: unknown | null
  editor_mode: PlatformTemplateEditorMode
  required_variables: string[]
  optional_variables: string[]
  change_note: string | null
  created_at: string
  created_by: string | null
}

export interface PlatformTemplatePreview {
  template_id: string
  rendered: {
    subject: string
    html_body: string
    text_body: string
  }
  all_variables: string[]
  unknown_variables: string[]
  required_variables: string[]
  optional_variables: string[]
}

export interface PlatformTemplateListFilters {
  code?: string
  channel?: PlatformTemplateChannel
  category?: PlatformTemplateCategory
  language?: string
  territoryId?: string
  includeInactive?: boolean
}

export interface CreatePlatformTemplateInput {
  code: string
  display_name: string
  description?: string
  channel: PlatformTemplateChannel
  category: PlatformTemplateCategory
  language?: string
  territory_id?: string | null
  subject?: string | null
  html_body?: string | null
  text_body?: string | null
  design_json?: unknown
  editor_mode?: PlatformTemplateEditorMode
  required_variables?: string[]
  optional_variables?: string[]
  is_active?: boolean
}

export interface UpdatePlatformTemplateInput {
  display_name?: string
  description?: string | null
  subject?: string | null
  html_body?: string | null
  text_body?: string | null
  design_json?: unknown
  editor_mode?: PlatformTemplateEditorMode
  required_variables?: string[]
  optional_variables?: string[]
  is_active?: boolean
  /** Free-text note recorded on the archived version row. */
  change_note?: string
}
