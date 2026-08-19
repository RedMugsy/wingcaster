-- Stage 2 — fin.usage_events LIST-partitioned by residency_key (A §6.1 / DL-009).
-- Default cell is '__platform__' (named usage_events_default), not a PG DEFAULT
-- catch-all: unknown keys must fail so ingest can DLQ PARTITION_MISSING (audit A-2).
-- SCHEMA-ABSENT (DL-007): no price_minor, no casts_charged, no rate_card_version.

CREATE TABLE fin.usage_events (
  id UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  residency_key TEXT NOT NULL,
  tenant_id UUID REFERENCES fin.tenants(id),
  holder_id UUID REFERENCES fin.holders(id),
  billing_account_id UUID REFERENCES fin.billing_accounts(id),
  source_system TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'ORIGINAL', 'CORRECTION', 'CANCELLATION', 'REPLACEMENT'
  )),
  corrects_event_id UUID,
  corrects_residency_key TEXT,
  subject_type TEXT,
  subject_id TEXT,
  quantity_units BIGINT NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  ingestion_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, residency_key),
  UNIQUE (environment, source_system, source_event_id, residency_key),
  CHECK (
    (event_kind = 'ORIGINAL' AND corrects_event_id IS NULL AND corrects_residency_key IS NULL)
    OR (event_kind <> 'ORIGINAL' AND corrects_event_id IS NOT NULL AND corrects_residency_key IS NOT NULL)
  ),
  FOREIGN KEY (corrects_event_id, corrects_residency_key)
    REFERENCES fin.usage_events (id, residency_key)
) PARTITION BY LIST (residency_key);

COMMENT ON TABLE fin.usage_events IS
  'Facts-only usage ingest (DL-007). No price_minor, casts_charged, or rate_card_version.';

CREATE TABLE fin.usage_events_default PARTITION OF fin.usage_events
  FOR VALUES IN ('__platform__');

CREATE INDEX idx_usage_events_tenant_occurred
  ON fin.usage_events (tenant_id, occurred_at DESC);

CREATE INDEX idx_usage_events_type_occurred
  ON fin.usage_events (event_type, occurred_at DESC);

CREATE INDEX idx_usage_events_corrects
  ON fin.usage_events (corrects_event_id, corrects_residency_key);

-- Tenant environment match when attributed; pre-attribution (NULL tenant_id) is allowed.
CREATE OR REPLACE FUNCTION fin.trg_env_matches_tenant_optional()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tenant_env TEXT;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
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

CREATE TRIGGER trg_usage_events_env_tenant
  BEFORE INSERT ON fin.usage_events
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant_optional();

-- Owner / FORCE RLS / grants / policies. RLS policies belong on the parent;
-- PostgreSQL rejects CREATE POLICY on individual LIST partitions.
CREATE OR REPLACE FUNCTION fin.apply_usage_events_security(p_table TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE fin.%I OWNER TO fin_migrator', p_table);
  EXECUTE format('GRANT SELECT, INSERT ON fin.%I TO fin_app_role', p_table);
  EXECUTE format(
    'GRANT SELECT ON fin.%I TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role',
    p_table
  );
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON fin.%I FROM fin_app_role', p_table);

  -- Every table (parent + every partition) gets ENABLE + FORCE RLS so direct-to-
  -- partition access cannot bypass tenant isolation. Policies live only on the
  -- parent (PostgreSQL routes SELECT/INSERT via parent); partitions with no
  -- policies deny non-owner direct access by default — that is the desired
  -- posture. H12 asserts this on every fin.* table.
  EXECUTE format('ALTER TABLE fin.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE fin.%I FORCE ROW LEVEL SECURITY', p_table);

  IF p_table <> 'usage_events' THEN
    RETURN;
  END IF;

  EXECUTE format('DROP POLICY IF EXISTS fin_migrator_all ON fin.%I', p_table);
  EXECUTE format(
    'CREATE POLICY fin_migrator_all ON fin.%I FOR ALL TO fin_migrator USING (true) WITH CHECK (true)',
    p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS fin_tenant_isolation ON fin.%I', p_table);
  EXECUTE format(
    $q$
    CREATE POLICY fin_tenant_isolation ON fin.%I
      AS PERMISSIVE FOR ALL
      TO fin_app_role, fin_finance_role, fin_auditor_role
      USING (
        tenant_id IS NOT NULL
        AND environment = current_setting('fin.environment', true)
        AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
      )
      WITH CHECK (
        tenant_id IS NOT NULL
        AND environment = current_setting('fin.environment', true)
        AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
      )
    $q$, p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS fin_usage_preattr_insert ON fin.%I', p_table);
  EXECUTE format(
    $q$
    CREATE POLICY fin_usage_preattr_insert ON fin.%I
      AS PERMISSIVE FOR INSERT TO fin_app_role
      WITH CHECK (
        tenant_id IS NULL
        AND (
          residency_key = '__platform__'
          OR EXISTS (
            SELECT 1 FROM fin.platform_legal_entities le
             WHERE le.residency_key = usage_events.residency_key
          )
        )
      )
    $q$, p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS fin_usage_preattr_select_recon ON fin.%I', p_table);
  EXECUTE format(
    $q$
    CREATE POLICY fin_usage_preattr_select_recon ON fin.%I
      AS PERMISSIVE FOR SELECT TO fin_recon_role
      USING (tenant_id IS NULL AND environment = current_setting('fin.environment', true))
    $q$, p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS fin_usage_preattr_select_bypass ON fin.%I', p_table);
  EXECUTE format(
    $q$
    CREATE POLICY fin_usage_preattr_select_bypass ON fin.%I
      AS PERMISSIVE FOR SELECT TO fin_app_role
      USING (tenant_id IS NULL AND fin.platform_admin_bypass())
    $q$, p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS fin_recon_all_read ON fin.%I', p_table);
  EXECUTE format(
    $q$
    CREATE POLICY fin_recon_all_read ON fin.%I
      FOR SELECT TO fin_recon_role
      USING (environment = current_setting('fin.environment', true))
    $q$, p_table
  );
END;
$$;

CREATE OR REPLACE FUNCTION fin.usage_events_partition_name(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'invalid residency_key %', p_key USING ERRCODE = '22P02';
  END IF;
  IF p_key = '__platform__' THEN
    RETURN 'usage_events_default';
  END IF;
  RETURN 'usage_events_' || regexp_replace(lower(p_key), '[^a-z0-9]+', '_', 'g');
END;
$$;

-- Creating a legal entity MUST create the matching LIST partition (A §6.1 / D §7.4).
CREATE OR REPLACE FUNCTION fin.ensure_usage_events_partition(p_key TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fin, public, pg_temp
AS $$
DECLARE
  part_name TEXT;
BEGIN
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN;
  END IF;
  part_name := fin.usage_events_partition_name(p_key);

  PERFORM pg_advisory_xact_lock(1011, hashtext(p_key));

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'fin' AND c.relname = part_name
  ) THEN
    PERFORM fin.apply_usage_events_security(part_name);
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE fin.%I PARTITION OF fin.usage_events FOR VALUES IN (%L)',
    part_name, p_key
  );
  PERFORM fin.apply_usage_events_security(part_name);
END;
$$;

CREATE OR REPLACE FUNCTION fin.trg_legal_entity_usage_partition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fin, public, pg_temp
AS $$
BEGIN
  PERFORM fin.ensure_usage_events_partition(NEW.residency_key);
  RETURN NEW;
END;
$$;

ALTER FUNCTION fin.apply_usage_events_security(TEXT) OWNER TO fin_migrator;
ALTER FUNCTION fin.usage_events_partition_name(TEXT) OWNER TO fin_migrator;
ALTER FUNCTION fin.ensure_usage_events_partition(TEXT) OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_legal_entity_usage_partition() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_tenant_optional() OWNER TO fin_migrator;

CREATE TRIGGER trg_legal_entity_usage_partition
  AFTER INSERT OR UPDATE OF residency_key ON fin.platform_legal_entities
  FOR EACH ROW EXECUTE FUNCTION fin.trg_legal_entity_usage_partition();

SELECT fin.apply_usage_events_security('usage_events');
SELECT fin.apply_usage_events_security('usage_events_default');

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT residency_key
      FROM fin.platform_legal_entities
     WHERE residency_key IS NOT NULL AND residency_key <> '__platform__'
  LOOP
    PERFORM fin.ensure_usage_events_partition(r.residency_key);
  END LOOP;
END
$$;

-- A §6.2: Stage 1 stub stored a JSON payload. Add the fact columns so DLQ
-- rows can be retried without reconstituting the event from JSON only.
ALTER TABLE fin.usage_events_dlq
  ADD COLUMN IF NOT EXISTS holder_id UUID REFERENCES fin.holders(id),
  ADD COLUMN IF NOT EXISTS billing_account_id UUID REFERENCES fin.billing_accounts(id),
  ADD COLUMN IF NOT EXISTS event_kind TEXT,
  ADD COLUMN IF NOT EXISTS corrects_event_id UUID,
  ADD COLUMN IF NOT EXISTS corrects_residency_key TEXT,
  ADD COLUMN IF NOT EXISTS subject_type TEXT,
  ADD COLUMN IF NOT EXISTS subject_id TEXT,
  ADD COLUMN IF NOT EXISTS quantity_units BIGINT,
  ADD COLUMN IF NOT EXISTS dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingestion_version INTEGER NOT NULL DEFAULT 1;

-- Pre-attribution DLQ landings (PARTITION_MISSING uses unknown keys).
CREATE POLICY fin_usage_dlq_preattr ON fin.usage_events_dlq
  AS PERMISSIVE FOR ALL TO fin_app_role
  USING (
    tenant_id IS NULL
    AND environment = current_setting('fin.environment', true)
  )
  WITH CHECK (
    tenant_id IS NULL
    AND environment = current_setting('fin.environment', true)
  );

CREATE POLICY fin_recon_all_read ON fin.usage_events_dlq
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

-- Replay worker deletes a DLQ row after a successful ingest (MUTABLE companion).
GRANT DELETE ON fin.usage_events_dlq TO fin_app_role;

GRANT EXECUTE ON FUNCTION fin.ensure_usage_events_partition(TEXT) TO fin_app_role, fin_migrator;
GRANT EXECUTE ON FUNCTION fin.usage_events_partition_name(TEXT) TO fin_app_role, fin_migrator;
GRANT EXECUTE ON FUNCTION fin.apply_usage_events_security(TEXT) TO fin_migrator;
GRANT EXECUTE ON FUNCTION fin.trg_env_matches_tenant_optional() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_legal_entity_usage_partition() TO fin_app_role;
