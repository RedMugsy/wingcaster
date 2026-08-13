-- Tenant authorization foundation.
--
-- Separates platform authorization, professional profiles, tenant membership,
-- and resource ownership. Existing agency tables remain available during the
-- application transition; deterministic tenant records preserve stable IDs and
-- allow old and new APIs to operate against the same production data.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS platform_role TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE role = 'admin'
  ) OR EXISTS (
    SELECT 1
    FROM agents
    WHERE role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize platform roles: legacy admin accounts require explicit staff classification';
  END IF;
END
$$;

UPDATE users
SET platform_role = 'platform_admin'
WHERE role = 'platform_admin'
  AND platform_role IS NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_platform_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_platform_role_check
  CHECK (platform_role IS NULL OR platform_role = 'platform_admin');

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  tenant_type TEXT NOT NULL CHECK (tenant_type IN ('personal', 'agency')),
  personal_owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  agency_id TEXT REFERENCES agencies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'read_only', 'suspended', 'closed')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT tenants_owner_shape_check CHECK (
    (tenant_type = 'personal' AND personal_owner_user_id IS NOT NULL AND agency_id IS NULL)
    OR
    (tenant_type = 'agency' AND agency_id IS NOT NULL AND personal_owner_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_personal_owner
  ON tenants(personal_owner_user_id)
  WHERE personal_owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_agency
  ON tenants(agency_id)
  WHERE agency_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug
  ON tenants(slug)
  WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  affiliation_mode TEXT NOT NULL
    CHECK (affiliation_mode IN ('personal', 'exclusive', 'non_exclusive')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'ended')),
  public_profile BOOLEAN NOT NULL DEFAULT false,
  lead_eligible BOOLEAN NOT NULL DEFAULT false,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_agency_member_id TEXT REFERENCES agency_members(id) ON DELETE SET NULL,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT tenant_memberships_guest_mode_check CHECK (
    role <> 'guest' OR affiliation_mode = 'non_exclusive'
  ),
  CONSTRAINT tenant_memberships_admin_owner_mode_check CHECK (
    role NOT IN ('owner', 'admin') OR affiliation_mode IN ('personal', 'exclusive')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_memberships_active_user
  ON tenant_memberships(tenant_id, user_id)
  WHERE status IN ('invited', 'active', 'suspended');
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_memberships_one_exclusive
  ON tenant_memberships(user_id)
  WHERE status = 'active' AND affiliation_mode = 'exclusive';
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_memberships_legacy
  ON tenant_memberships(legacy_agency_member_id)
  WHERE legacy_agency_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user
  ON tenant_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant
  ON tenant_memberships(tenant_id, status);

-- Every canonical agent receives a durable personal workspace. The workspace
-- remains even when an agency policy makes it commercially read-only.
INSERT INTO tenants (
  id, tenant_type, personal_owner_user_id, name, slug, status, settings,
  created_at, updated_at, data
)
SELECT
  'personal:' || u.id,
  'personal',
  u.id,
  COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'Personal workspace'),
  NULL,
  'active',
  jsonb_build_object('workspace_mode', 'active'),
  COALESCE(u.created_at, CURRENT_TIMESTAMP),
  COALESCE(u.updated_at, u.created_at, CURRENT_TIMESTAMP),
  jsonb_build_object(
    'tenant_type', 'personal',
    'personal_owner_user_id', u.id,
    'workspace_mode', 'active'
  )
FROM users u
JOIN agents a ON a.user_id = u.id
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_memberships (
  id, tenant_id, user_id, role, affiliation_mode, status, public_profile,
  lead_eligible, joined_at, created_at, updated_at, data
)
SELECT
  'personal-membership:' || u.id,
  'personal:' || u.id,
  u.id,
  'owner',
  'personal',
  'active',
  true,
  true,
  COALESCE(u.created_at, CURRENT_TIMESTAMP),
  COALESCE(u.created_at, CURRENT_TIMESTAMP),
  COALESCE(u.updated_at, u.created_at, CURRENT_TIMESTAMP),
  jsonb_build_object(
    'tenant_id', 'personal:' || u.id,
    'user_id', u.id,
    'role', 'owner',
    'affiliation_mode', 'personal',
    'status', 'active'
  )
FROM users u
JOIN agents a ON a.user_id = u.id
ON CONFLICT (id) DO NOTHING;

-- Agencies become agency tenants without changing their public or foreign-key
-- identity. Existing memberships are treated as exclusive because the legacy
-- application enforced one active agency affiliation per user.
INSERT INTO tenants (
  id, tenant_type, agency_id, name, slug, status, settings,
  created_at, updated_at, data
)
SELECT
  'agency:' || a.id,
  'agency',
  a.id,
  a.name,
  a.slug,
  'active',
  jsonb_build_object(
    'exclusive_personal_workspace_mode', 'read_only',
    'default_non_exclusive_role', 'member'
  ),
  COALESCE(a.created_at, CURRENT_TIMESTAMP),
  COALESCE(a.updated_at, a.created_at, CURRENT_TIMESTAMP),
  jsonb_build_object(
    'tenant_type', 'agency',
    'agency_id', a.id,
    'exclusive_personal_workspace_mode', 'read_only',
    'default_non_exclusive_role', 'member'
  )
FROM agencies a
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_memberships (
  id, tenant_id, user_id, role, affiliation_mode, status, public_profile,
  lead_eligible, capabilities, legacy_agency_member_id, invited_by, joined_at,
  ended_at, end_reason, created_at, updated_at, data
)
SELECT
  'agency-membership:' || m.id,
  'agency:' || m.agency_id,
  m.user_id,
  CASE m.role
    WHEN 'owner' THEN 'owner'
    WHEN 'admin' THEN 'admin'
    ELSE 'member'
  END,
  'exclusive',
  CASE
    WHEN m.status = 'active' THEN 'active'
    WHEN m.status = 'invited' THEN 'invited'
    WHEN m.status = 'suspended' THEN 'suspended'
    ELSE 'ended'
  END,
  true,
  m.status = 'active',
  '{}'::jsonb,
  m.id,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM users inviter WHERE inviter.id = NULLIF(m.data->>'invited_by', '')
    ) THEN NULLIF(m.data->>'invited_by', '')
    ELSE NULL
  END,
  COALESCE(m.joined_at, m.created_at),
  m.ended_at,
  m.end_reason,
  COALESCE(m.created_at, CURRENT_TIMESTAMP),
  COALESCE(m.updated_at, m.created_at, CURRENT_TIMESTAMP),
  jsonb_build_object(
    'tenant_id', 'agency:' || m.agency_id,
    'user_id', m.user_id,
    'role', CASE m.role
      WHEN 'owner' THEN 'owner'
      WHEN 'admin' THEN 'admin'
      ELSE 'member'
    END,
    'affiliation_mode', 'exclusive',
    'status', CASE
      WHEN m.status = 'active' THEN 'active'
      WHEN m.status = 'invited' THEN 'invited'
      WHEN m.status = 'suspended' THEN 'suspended'
      ELSE 'ended'
    END,
    'legacy_agency_member_id', m.id
  )
FROM agency_members m
WHERE m.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- agencies.owner_id is explicit historical ownership authority. Promote its
-- matching active canonical membership before creating a missing membership;
-- this does not infer ownership from an admin role.
UPDATE tenant_memberships membership
SET
  role = 'owner',
  updated_at = CURRENT_TIMESTAMP,
  data = membership.data || jsonb_build_object(
    'role', 'owner',
    'ownership_source', 'agencies.owner_id'
  )
FROM agencies agency
WHERE agency.owner_id IS NOT NULL
  AND membership.tenant_id = 'agency:' || agency.id
  AND membership.user_id = agency.owner_id
  AND membership.status = 'active';

INSERT INTO agency_members (
  id, agency_id, user_id, agent_id, role, status, joined_at,
  created_at, updated_at, data
)
SELECT
  'tenant-owner:' || agency.id || ':' || agency.owner_id,
  agency.id,
  agency.owner_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM agents agent WHERE agent.id = agency.owner_id) THEN agency.owner_id
    ELSE NULL
  END,
  'owner',
  'active',
  COALESCE(agency.created_at, CURRENT_TIMESTAMP),
  COALESCE(agency.created_at, CURRENT_TIMESTAMP),
  COALESCE(agency.updated_at, agency.created_at, CURRENT_TIMESTAMP),
  jsonb_build_object(
    'agency_id', agency.id,
    'user_id', agency.owner_id,
    'role', 'owner',
    'status', 'active',
    'source', 'agencies.owner_id'
  )
FROM agencies agency
WHERE agency.owner_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM users owner WHERE owner.id = agency.owner_id)
  AND NOT EXISTS (
    SELECT 1
    FROM agency_members membership
    WHERE membership.agency_id = agency.id
      AND membership.user_id = agency.owner_id
      AND membership.status = 'active'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_memberships (
  id, tenant_id, user_id, role, affiliation_mode, status, public_profile,
  lead_eligible, legacy_agency_member_id, joined_at, created_at, updated_at, data
)
SELECT
  'agency-owner:' || a.id || ':' || a.owner_id,
  'agency:' || a.id,
  a.owner_id,
  'owner',
  'exclusive',
  'active',
  true,
  true,
  owner_membership.id,
  COALESCE(owner_membership.joined_at, a.created_at, CURRENT_TIMESTAMP),
  COALESCE(a.created_at, CURRENT_TIMESTAMP),
  COALESCE(a.updated_at, a.created_at, CURRENT_TIMESTAMP),
  jsonb_build_object(
    'tenant_id', 'agency:' || a.id,
    'user_id', a.owner_id,
    'role', 'owner',
    'affiliation_mode', 'exclusive',
    'status', 'active',
    'source', 'agencies.owner_id',
    'legacy_agency_member_id', owner_membership.id
  )
FROM agencies a
JOIN agency_members owner_membership
  ON owner_membership.agency_id = a.id
 AND owner_membership.user_id = a.owner_id
 AND owner_membership.status = 'active'
WHERE a.owner_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = a.owner_id)
  AND NOT EXISTS (
    SELECT 1
    FROM tenant_memberships membership
    WHERE membership.tenant_id = 'agency:' || a.id
      AND membership.role = 'owner'
      AND membership.status = 'active'
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION validate_tenant_membership_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant tenants%ROWTYPE;
BEGIN
  SELECT * INTO target_tenant FROM tenants WHERE id = NEW.tenant_id;

  IF target_tenant.tenant_type = 'personal' THEN
    IF NEW.user_id <> target_tenant.personal_owner_user_id
       OR NEW.role <> 'owner'
       OR NEW.affiliation_mode <> 'personal' THEN
      RAISE EXCEPTION 'Personal tenants may only contain their canonical owner membership';
    END IF;
  ELSIF NEW.affiliation_mode = 'personal' THEN
    RAISE EXCEPTION 'Personal affiliation mode is not valid for an agency tenant';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_validate_tenant_membership_shape ON tenant_memberships;
CREATE TRIGGER trg_validate_tenant_membership_shape
BEFORE INSERT OR UPDATE OF tenant_id, user_id, role, affiliation_mode
ON tenant_memberships
FOR EACH ROW
EXECUTE FUNCTION validate_tenant_membership_shape();

CREATE OR REPLACE FUNCTION enforce_tenant_owner_continuity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_tenant_id TEXT := OLD.tenant_id;
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE id = affected_tenant_id)
     AND NOT EXISTS (
       SELECT 1
       FROM tenant_memberships
       WHERE tenant_id = affected_tenant_id
         AND role = 'owner'
         AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Tenant % must retain at least one active owner', affected_tenant_id;
  END IF;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_tenant_owner_continuity ON tenant_memberships;
CREATE CONSTRAINT TRIGGER trg_tenant_owner_continuity
AFTER DELETE OR UPDATE OF tenant_id, role, status
ON tenant_memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.role = 'owner' AND OLD.status = 'active')
EXECUTE FUNCTION enforce_tenant_owner_continuity();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tenants tenant
    WHERE tenant.status <> 'closed'
      AND NOT EXISTS (
        SELECT 1
        FROM tenant_memberships membership
        WHERE membership.tenant_id = tenant.id
          AND membership.role = 'owner'
          AND membership.status = 'active'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot establish an active owner for every tenant';
  END IF;
END
$$;

-- Tenant Admin-defined routing policies. Relationships are evaluated by the
-- routing service first only when the policy enables that behavior.
CREATE TABLE IF NOT EXISTS tenant_lead_routing_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  strategy TEXT NOT NULL CHECK (
    strategy IN ('round_robin', 'first_response', 'least_loaded', 'weighted', 'manual')
  ),
  relationship_priority BOOLEAN NOT NULL DEFAULT true,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  eligible_members JSONB NOT NULL DEFAULT '{}'::jsonb,
  strategy_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  claim_timeout_seconds INTEGER CHECK (claim_timeout_seconds IS NULL OR claim_timeout_seconds > 0),
  response_timeout_seconds INTEGER CHECK (response_timeout_seconds IS NULL OR response_timeout_seconds > 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  escalation_membership_id TEXT REFERENCES tenant_memberships(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_tenant_lead_routing_policy_order
  ON tenant_lead_routing_policies(tenant_id, enabled, priority);

CREATE TABLE IF NOT EXISTS contact_relationships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  agent_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_type TEXT NOT NULL CHECK (party_type IN ('buyer', 'seller', 'landlord', 'tenant')),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('representation', 'mandate', 'affinity')),
  exclusivity TEXT NOT NULL CHECK (exclusivity IN ('exclusive', 'non_exclusive')),
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'active', 'suspended', 'ended', 'expired')),
  consent_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_contact_relationships_routing
  ON contact_relationships(contact_id, party_type, status);
CREATE INDEX IF NOT EXISTS idx_contact_relationships_tenant
  ON contact_relationships(tenant_id, status);

CREATE TABLE IF NOT EXISTS lead_assignments (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  routing_policy_id TEXT REFERENCES tenant_lead_routing_policies(id) ON DELETE SET NULL,
  relationship_id TEXT REFERENCES contact_relationships(id) ON DELETE SET NULL,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (
    status IN ('offered', 'claimed', 'responded', 'timed_out', 'clawed_back', 'requeued', 'escalated', 'completed')
  ),
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  offered_at TIMESTAMPTZ,
  claim_due_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  response_due_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_inquiry
  ON lead_assignments(inquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_due
  ON lead_assignments(status, claim_due_at, response_due_at);

-- Resource ownership is distinct from assignment. Existing agency-linked
-- properties remain agency-owned; independent records become personal-owned.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ownership_type TEXT,
  ADD COLUMN IF NOT EXISTS custody_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exit_disposition TEXT;

UPDATE properties p
SET
  tenant_id = CASE
    WHEN p.agency_id IS NOT NULL THEN 'agency:' || p.agency_id
    WHEN p.agent_id IS NOT NULL THEN 'personal:' || p.agent_id
    ELSE NULL
  END,
  ownership_type = CASE
    WHEN p.agency_id IS NOT NULL THEN 'agency'
    ELSE 'personal'
  END,
  custody_tenant_id = CASE
    WHEN p.agency_id IS NOT NULL THEN 'agency:' || p.agency_id
    WHEN p.agent_id IS NOT NULL THEN 'personal:' || p.agent_id
    ELSE NULL
  END,
  source_user_id = COALESCE(p.source_user_id, p.agent_id),
  exit_disposition = CASE
    WHEN p.agency_id IS NOT NULL THEN COALESCE(p.exit_disposition, 'case_review')
    ELSE COALESCE(p.exit_disposition, 'agent_retains')
  END
WHERE p.tenant_id IS NULL
   OR p.ownership_type IS NULL
   OR p.custody_tenant_id IS NULL
   OR p.source_user_id IS NULL
   OR p.exit_disposition IS NULL;

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_ownership_type_check;
ALTER TABLE properties
  ADD CONSTRAINT properties_ownership_type_check
  CHECK (ownership_type IS NULL OR ownership_type IN ('personal', 'agency', 'shared'));
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_exit_disposition_check;
ALTER TABLE properties
  ADD CONSTRAINT properties_exit_disposition_check
  CHECK (
    exit_disposition IS NULL
    OR exit_disposition IN ('agency_retains', 'agent_retains', 'case_review')
  );
CREATE INDEX IF NOT EXISTS idx_properties_tenant_id ON properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_properties_custody_tenant_id ON properties(custody_tenant_id);
CREATE INDEX IF NOT EXISTS idx_properties_source_user_id ON properties(source_user_id);

-- Fail closed if deterministic backfill could not establish ownership for an
-- existing assigned listing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM properties
    WHERE agent_id IS NOT NULL
      AND (tenant_id IS NULL OR custody_tenant_id IS NULL OR ownership_type IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot establish tenant ownership for an assigned property';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS property_disposition_cases (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES tenant_memberships(id) ON DELETE RESTRICT,
  agency_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  personal_tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  proposed_disposition TEXT NOT NULL
    CHECK (proposed_disposition IN ('agency_retains', 'agent_retains', 'archive')),
  agency_decision TEXT CHECK (agency_decision IN ('approved', 'rejected')),
  agent_decision TEXT CHECK (agent_decision IN ('approved', 'rejected')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'agreed', 'disputed', 'completed', 'cancelled')),
  initiated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_disposition_open_case
  ON property_disposition_cases(property_id)
  WHERE status IN ('pending', 'agreed', 'disputed');
