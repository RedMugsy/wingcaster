-- Platform-owned, admin-editable message templates.
--
-- Distinct from the existing `message_templates` table, which is
-- tenant-owned (an agent's or agency's outbound copy to their customers)
-- and stays untouched. This system is for messages the PLATFORM sends TO
-- tenants — signup OTPs, welcome emails, WhatsApp onboarding guides, and
-- similar. Different permissions (platform-admin only), different
-- validation rules (required variables are enforced), different fallback
-- strategy (per-territory, per-language with defaults).
--
-- Design shape mirrors the editor plan captured in the handover:
--   * `editor_mode` = 'unlayer' | 'mjml' | 'raw' — one table serves all
--     three; Unlayer ships first, MJML and raw follow-up commits slot in
--     without a further migration.
--   * `design_json` — Unlayer's serialised builder state (or MJML source
--     when editor_mode='mjml'), so an admin can re-edit visually.
--   * `html_body` — the compiled/final HTML actually used at send time.
--     Populated for every mode; renders identically regardless of how
--     the admin authored it.
--   * `required_variables` — service-layer enforcement. An OTP template
--     saved without {{code}} silently breaks signup for everyone; the
--     column names exactly which variables must appear in body/subject
--     for the template to be publishable.
--   * `territory_id` NULLABLE — NULL is the global default; a row with
--     a non-null territory_id overrides it for that territory.
--   * `is_seed` — templates that ship with the platform. Admins can
--     edit them (bumping to a new version), but cannot delete them, so
--     a broken customisation always has a working default underneath.

CREATE TABLE IF NOT EXISTS platform_message_templates (
  id TEXT PRIMARY KEY,
  -- Stable code the application refers to. Not user-visible; the admin
  -- UI shows the display name. Chosen when the template is seeded and
  -- never changes — that would break every send site referring to it.
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  channel TEXT NOT NULL,           -- email | whatsapp | sms
  category TEXT NOT NULL,          -- auth | onboarding | billing | notification | marketing
  -- Variant axes. NULL territory = global default; NULL language falls
  -- back to English through the resolver.
  language TEXT NOT NULL DEFAULT 'en',
  territory_id TEXT REFERENCES territories(id) ON DELETE CASCADE,
  -- Content, addressed one field at a time so the DAL's SELECT * can
  -- return everything without a JSONB unpack on every read.
  subject TEXT,
  html_body TEXT,
  text_body TEXT,
  design_json JSONB,
  editor_mode TEXT NOT NULL DEFAULT 'unlayer',
  -- Variables the admin's saved body/subject MUST reference. Enforced
  -- at write time by the service, and again on render. Optional
  -- variables are documentation only.
  required_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Deactivating rather than deleting keeps history intact; sends fall
  -- back through the resolver as if the row were absent.
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  -- version is the CURRENT version number. Every write bumps it and
  -- copies the previous state to platform_message_template_versions.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  updated_by TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- One active template per (code, language, territory). A NULL
-- territory_id is a distinct slot from any specific territory. Without
-- this UNIQUE, resolve-with-fallback could return two "best" rows and
-- have to pick arbitrarily.
--
-- CAVEAT: Postgres treats NULL as distinct in UNIQUE constraints, so
-- two rows with the same (code, language, NULL) would technically both
-- be permitted. We enforce that shape as a partial unique index below.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_msg_templates_scoped
  ON platform_message_templates (code, language, territory_id)
  WHERE territory_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_msg_templates_global
  ON platform_message_templates (code, language)
  WHERE territory_id IS NULL;

-- Lookup shape used by the resolver every send.
CREATE INDEX IF NOT EXISTS idx_platform_msg_templates_resolve
  ON platform_message_templates (code, language, territory_id)
  WHERE is_active = true;

-- Constraints. Written as ALTER so the migration is safe to re-apply on
-- a database that has an older draft of the table.
ALTER TABLE platform_message_templates
  DROP CONSTRAINT IF EXISTS platform_msg_templates_channel_check;
ALTER TABLE platform_message_templates
  ADD CONSTRAINT platform_msg_templates_channel_check
  CHECK (channel IN ('email', 'whatsapp', 'sms'));

ALTER TABLE platform_message_templates
  DROP CONSTRAINT IF EXISTS platform_msg_templates_editor_mode_check;
ALTER TABLE platform_message_templates
  ADD CONSTRAINT platform_msg_templates_editor_mode_check
  CHECK (editor_mode IN ('unlayer', 'mjml', 'raw'));

ALTER TABLE platform_message_templates
  DROP CONSTRAINT IF EXISTS platform_msg_templates_category_check;
ALTER TABLE platform_message_templates
  ADD CONSTRAINT platform_msg_templates_category_check
  CHECK (category IN ('auth', 'onboarding', 'billing', 'notification', 'marketing'));

-- Email needs at least one body variant; non-email needs text.
ALTER TABLE platform_message_templates
  DROP CONSTRAINT IF EXISTS platform_msg_templates_body_required;
ALTER TABLE platform_message_templates
  ADD CONSTRAINT platform_msg_templates_body_required
  CHECK (
    (channel = 'email'
      AND (html_body IS NOT NULL AND html_body <> '' OR text_body IS NOT NULL AND text_body <> ''))
    OR (channel <> 'email'
      AND text_body IS NOT NULL AND text_body <> '')
  );

-- Email templates require a subject.
ALTER TABLE platform_message_templates
  DROP CONSTRAINT IF EXISTS platform_msg_templates_subject_for_email;
ALTER TABLE platform_message_templates
  ADD CONSTRAINT platform_msg_templates_subject_for_email
  CHECK (channel <> 'email' OR (subject IS NOT NULL AND subject <> ''));

-- Version history table. Every write appends a row so an admin who
-- broke a template at 2am can revert with one click rather than
-- retyping the previous copy.
CREATE TABLE IF NOT EXISTS platform_message_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES platform_message_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  subject TEXT,
  html_body TEXT,
  text_body TEXT,
  design_json JSONB,
  editor_mode TEXT NOT NULL,
  required_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  optional_variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_platform_msg_template_versions_template
  ON platform_message_template_versions (template_id, version DESC);
