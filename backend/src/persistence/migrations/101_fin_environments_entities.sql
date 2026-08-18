-- Stage 1 — platforms, environments, legal entities, tenants, holders,
-- billing accounts, org tree, funding edges, account controls (A §3).

CREATE TABLE fin.platforms (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_platforms_bump_version
  BEFORE UPDATE ON fin.platforms
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.environments (
  id UUID PRIMARY KEY,
  platform_id UUID NOT NULL REFERENCES fin.platforms(id),
  code TEXT NOT NULL CHECK (code IN ('LIVE', 'TEST')),
  clock_mode TEXT NOT NULL CHECK (clock_mode IN ('WALL', 'INJECTED')),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (platform_id, code)
);

CREATE TRIGGER trg_environments_bump_version
  BEFORE UPDATE ON fin.environments
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.platform_legal_entities (
  id UUID PRIMARY KEY,
  platform_id UUID NOT NULL REFERENCES fin.platforms(id),
  code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  jurisdiction CHAR(2) NOT NULL,
  tax_id TEXT,
  billing_currency CHAR(3) NOT NULL,
  residency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (platform_id, code)
);

CREATE TRIGGER trg_platform_legal_entities_bump_version
  BEFORE UPDATE ON fin.platform_legal_entities
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.tenants (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  public_tenant_id TEXT NOT NULL REFERENCES public.tenants(id),
  platform_id UUID NOT NULL REFERENCES fin.platforms(id),
  default_legal_entity_id UUID REFERENCES fin.platform_legal_entities(id),
  default_residency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'READ_ONLY', 'SUSPENDED', 'CLOSED')),
  erasure_status TEXT NOT NULL DEFAULT 'NONE' CHECK (erasure_status IN (
    'NONE', 'REQUESTED', 'PSEUDONYMISED', 'BLOCKED_LEGAL_HOLD'
  )),
  erased_at TIMESTAMPTZ,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  legal_hold_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, public_tenant_id)
);

CREATE TRIGGER trg_tenants_bump_version
  BEFORE UPDATE ON fin.tenants
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.holders (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('TENANT_ROOT', 'ORGANISATIONAL_NODE', 'BILLING_ACCOUNT')),
  display_name TEXT NOT NULL,
  parent_holder_id UUID REFERENCES fin.holders(id),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_holders_bump_version
  BEFORE UPDATE ON fin.holders
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_holders_env_tenant
  BEFORE INSERT OR UPDATE ON fin.holders
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.billing_accounts (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  seller_legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  billing_currency CHAR(3) NOT NULL,
  billing_timezone TEXT NOT NULL,
  invoice_delivery TEXT NOT NULL CHECK (invoice_delivery IN ('EMAIL', 'PORTAL', 'BOTH')),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_billing_accounts_bump_version
  BEFORE UPDATE ON fin.billing_accounts
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_billing_accounts_env_tenant
  BEFORE INSERT OR UPDATE ON fin.billing_accounts
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.cost_centres (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, environment, code)
);

CREATE TRIGGER trg_cost_centres_bump_version
  BEFORE UPDATE ON fin.cost_centres
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_cost_centres_env_tenant
  BEFORE INSERT OR UPDATE ON fin.cost_centres
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.organisational_nodes (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  parent_node_id UUID REFERENCES fin.organisational_nodes(id),
  cost_centre_id UUID REFERENCES fin.cost_centres(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_organisational_nodes_bump_version
  BEFORE UPDATE ON fin.organisational_nodes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_organisational_nodes_env_tenant
  BEFORE INSERT OR UPDATE ON fin.organisational_nodes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.funding_relationships (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  from_holder_id UUID NOT NULL REFERENCES fin.holders(id),
  to_holder_id UUID NOT NULL REFERENCES fin.holders(id),
  relationship_kind TEXT NOT NULL CHECK (relationship_kind IN ('PAYS_FOR', 'MAY_DRAW', 'MAY_ESCALATE')),
  priority INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, from_holder_id, to_holder_id, relationship_kind)
);

CREATE TRIGGER trg_funding_relationships_bump_version
  BEFORE UPDATE ON fin.funding_relationships
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_funding_relationships_env_tenant
  BEFORE INSERT OR UPDATE ON fin.funding_relationships
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.account_controls (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('TENANT', 'HOLDER', 'BILLING_ACCOUNT', 'CONTRACT')),
  subject_id UUID NOT NULL,
  allow_prepaid_usage BOOLEAN NOT NULL,
  allow_postpaid_usage BOOLEAN NOT NULL,
  allow_purchases BOOLEAN NOT NULL,
  allow_transfers BOOLEAN NOT NULL,
  allow_refunds BOOLEAN NOT NULL,
  allow_grants BOOLEAN NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, subject_type, subject_id)
);

CREATE TRIGGER trg_account_controls_bump_version
  BEFORE UPDATE ON fin.account_controls
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

-- H9 / DL-043 — legal hold blocks erasure (full pseudonymise is Stage 13).
CREATE OR REPLACE FUNCTION fin.request_erasure(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  held BOOLEAN;
BEGIN
  SELECT legal_hold INTO held FROM fin.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF held IS NULL THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id USING ERRCODE = 'P0002';
  END IF;
  IF held THEN
    UPDATE fin.tenants
       SET erasure_status = 'BLOCKED_LEGAL_HOLD'
     WHERE id = p_tenant_id;
    RETURN 'BLOCKED_LEGAL_HOLD';
  END IF;
  UPDATE fin.tenants
     SET erasure_status = 'REQUESTED'
   WHERE id = p_tenant_id;
  RETURN 'REQUESTED';
END;
$$;
