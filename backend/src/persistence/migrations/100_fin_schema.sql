-- Stage 1 — fin schema bootstrap (A §18, H §0).
-- Extensions + helper functions used by 101–109. No economic tables yet.

CREATE SCHEMA IF NOT EXISTS fin;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

COMMENT ON SCHEMA fin IS
  'Financial Control Plane. commercial.* is frozen until Stage 13.';

-- Optimistic concurrency bump (D §6.1 / DL-004). Writer must still
-- WHERE version = $expected; omitting that loses C-2 protection.
CREATE OR REPLACE FUNCTION fin.trg_bump_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

-- 7f/3 at the SQL boundary (H §1.1). platform_admin without elevated
-- is NOT a bypass — E1/E2 lesson.
CREATE OR REPLACE FUNCTION fin.platform_admin_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('fin.platform_admin', true) = 'on'
    AND current_setting('fin.elevated', true) = 'on'
$$;

-- Tenant-row environment must match the parent tenant (A §3.5).
CREATE OR REPLACE FUNCTION fin.trg_env_matches_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_env TEXT;
BEGIN
  SELECT environment INTO tenant_env FROM fin.tenants WHERE id = NEW.tenant_id;
  IF tenant_env IS NULL THEN
    RAISE EXCEPTION 'tenant % not found', NEW.tenant_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM tenant_env THEN
    RAISE EXCEPTION 'environment % does not match tenant % (%)',
      NEW.environment, NEW.tenant_id, tenant_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
